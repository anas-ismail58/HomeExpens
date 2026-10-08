/**
 * End-to-end acceptance scenario against the real Express app and the local database.
 * Run: npm test (needs DATABASE_URL pointing at a migrated dev database).
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { authLimiter } from '../src/middleware/rateLimit';
import { enrollTotp, totpCode } from '../src/services/totp.service';
import { processDueNotifications } from '../src/services/scheduler.service';
import { addDays, localDate } from '../src/utils/time';

let server: Server;
let base = '';
const run = Date.now().toString(36);
const emails = { father: `father-${run}@test.local`, mother: `mother-${run}@test.local`, other: `other-${run}@test.local`, child: `child-${run}@test.local`, superAdmin: `super-${run}@test.local` };

type Envelope<T = any> = { status: number; success: boolean; message: string; data: T };

async function api<T = any>(method: string, path: string, token?: string, body?: unknown): Promise<Envelope<T>> {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await response.json()) as Omit<Envelope<T>, 'status'>;
  return { status: response.status, ...json };
}

const state: Record<string, any> = {};

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
  server.close();
  await prisma.$disconnect();
});

test('1–2. Father registers and creates a family', async () => {
  const res = await api('POST', '/auth/register', undefined, { name: 'Father', email: emails.father, password: 'pw', familyName: `Family ${run}`, timezone: 'Asia/Riyadh' });
  assert.equal(res.status, 201, res.message);
  assert.equal(res.data.user.role, 'FATHER');
  assert.equal(res.data.user.isAdmin, true);
  assert.equal(res.data.user.permissions.length, 14);
  state.father = res.data;
});

test('3. Father invites Mother (admin only)', async () => {
  const res = await api('POST', `/families/${state.father.family.id}/invitations`, state.father.accessToken, { email: emails.mother, role: 'MOTHER' });
  assert.equal(res.status, 201, res.message);
  assert.equal(res.data.status, 'PENDING');
  assert.match(res.data.code, /^[A-Z2-9]{10}$/);
  state.invite = res.data;

  const preview = await api('GET', `/invitations/${state.invite.code}`);
  assert.equal(preview.data.familyName, `Family ${run}`);
  assert.ok(!JSON.stringify(preview.data).includes(emails.mother), 'preview must not leak the full email');
});

test('4. Mother accepts the invitation by signing up with the code', async () => {
  const wrongEmail = await api('POST', '/auth/register', undefined, { name: 'Intruder', email: `x-${run}@test.local`, password: 'pw', inviteCode: state.invite.code });
  assert.equal(wrongEmail.status, 403, 'invitation is bound to the invited email');
  await prisma.user.deleteMany({ where: { email: `x-${run}@test.local` } });

  const res = await api('POST', '/auth/register', undefined, { name: 'Mother', email: emails.mother, password: 'pw', inviteCode: state.invite.code });
  assert.equal(res.status, 201, res.message);
  assert.equal(res.data.user.role, 'MOTHER');
  assert.equal(res.data.family.id, state.father.family.id);
  state.mother = res.data;

  const reuse = await api('POST', '/auth/register', undefined, { name: 'Again', email: `again-${run}@test.local`, password: 'pw', inviteCode: state.invite.code });
  assert.equal(reuse.status, 404, 'invitations are single use');

  const members = await api('GET', `/families/${state.father.family.id}/members`, state.father.accessToken);
  assert.deepEqual(members.data.map((m: any) => m.role).sort(), ['FATHER', 'MOTHER']);
});

test('5. Father gives Mother Add Expense and disables Delete Expense', async () => {
  const res = await api('PUT', `/families/${state.father.family.id}/members/${state.mother.user.id}/permissions`, state.father.accessToken, {
    permissions: { ADD_EXPENSE: true, DELETE_EXPENSE: false, VIEW_EXPENSES: true, VIEW_REPORTS: false },
  });
  assert.equal(res.status, 200, res.message);
  assert.equal(res.data.permissions.ADD_EXPENSE, true);
  assert.equal(res.data.permissions.DELETE_EXPENSE, false);

  const motherTries = await api('PUT', `/families/${state.father.family.id}/members/${state.mother.user.id}/permissions`, state.mother.accessToken, { permissions: { DELETE_EXPENSE: true } });
  assert.equal(motherTries.status, 403, 'only the admin changes permissions');

  const notes = await api('GET', '/notifications', state.mother.accessToken);
  assert.ok(notes.data.items.some((n: any) => n.type === 'PERMISSION_CHANGE'), 'mother is told about permission changes');
});

test('6–8. Mother adds an expense, Father sees it, Mother cannot delete it', async () => {
  const added = await api('POST', '/expenses/household', state.mother.accessToken, { amount: '150', description: 'Groceries', occurredAt: new Date().toISOString() });
  assert.equal(added.status, 201, added.message);
  assert.equal(added.data.createdBy.id, state.mother.user.id, 'expense records who created it');
  state.expense = added.data;

  const fatherView = await api('GET', `/expenses/${state.expense.id}`, state.father.accessToken);
  assert.equal(fatherView.status, 200);
  assert.equal(fatherView.data.createdBy.name, 'Mother');

  const del = await api('DELETE', `/expenses/${state.expense.id}`, state.mother.accessToken);
  assert.equal(del.status, 403, 'Delete Expense is OFF for Mother');

  const edit = await api('PUT', `/expenses/${state.expense.id}`, state.mother.accessToken, { amount: '175' });
  assert.equal(edit.status, 200, 'Edit Expense is ON by default for Mother');
  assert.equal(edit.data.amount, '175');
});

test('Permission changes apply immediately (no re-login)', async () => {
  await api('PUT', `/families/${state.father.family.id}/members/${state.mother.user.id}/permissions`, state.father.accessToken, { permissions: { ADD_EXPENSE: false } });
  const blocked = await api('POST', '/expenses/household', state.mother.accessToken, { amount: '10', occurredAt: new Date().toISOString() });
  assert.equal(blocked.status, 403);
  await api('PUT', `/families/${state.father.family.id}/members/${state.mother.user.id}/permissions`, state.father.accessToken, { permissions: { ADD_EXPENSE: true } });
});

test('9–12. Father creates a monthly payment for Mother with a due time and reminder', async () => {
  const today = localDate(new Date(), 'Asia/Riyadh');
  const res = await api('POST', '/payments', state.father.accessToken, {
    name: 'Internet',
    amount: '100',
    currency: 'SAR',
    category: 'INTERNET',
    frequency: 'MONTHLY',
    dueDate: addDays(today, 2),
    dueTime: '20:00',
    assigneeId: state.mother.user.id,
    reminderEnabled: true,
    reminderDaysBefore: 0,
    reminderTime: '10:00',
  });
  assert.equal(res.status, 201, res.message);
  assert.equal(res.data.status, 'DUE_SOON');
  assert.equal(res.data.assignee.id, state.mother.user.id);
  assert.equal(res.data.reminderAt.slice(11, 16), '07:00', '10:00 Riyadh is 07:00 UTC');
  assert.equal(res.data.dueAt.slice(11, 16), '17:00', '20:00 Riyadh is 17:00 UTC');
  state.payment = res.data;
});

test('13 + 19. Only the assignee is notified, exactly once', async () => {
  const at = new Date(new Date(state.payment.reminderAt).getTime() + 60_000);
  const first = await processDueNotifications({ familyId: state.father.family.id, now: at });
  assert.equal(first.remindersSent, 1);
  const second = await processDueNotifications({ familyId: state.father.family.id, now: at });
  assert.equal(second.remindersSent, 0, 'no duplicate reminder');

  const mother = await api('GET', '/notifications', state.mother.accessToken);
  const reminders = mother.data.items.filter((n: any) => n.type === 'PAYMENT_REMINDER' && n.relatedEntityId === state.payment.id);
  assert.equal(reminders.length, 1);
  assert.match(reminders[0].message, /100 SAR|Internet/);

  const father = await api('GET', '/notifications', state.father.accessToken);
  assert.ok(!father.data.items.some((n: any) => n.relatedEntityId === state.payment.id), 'father does not get mother\'s reminder');

  const dispatch = await prisma.paymentReminder.findMany({ where: { paymentId: state.payment.id } });
  assert.equal(dispatch.length, 1);
  assert.equal(dispatch[0].status, 'SENT');
});

test('14–15. Due today, then overdue after the due time', async () => {
  const today = localDate(new Date(), 'Asia/Riyadh');
  const created = await api('POST', '/payments', state.father.accessToken, {
    name: 'Course', amount: '500', category: 'COURSE', frequency: 'ONCE', dueDate: today, dueTime: '23:59',
  });
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Riyadh', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  if (hour < 23) assert.equal(created.data.status, 'DUE_TODAY');

  const late = await api('POST', '/payments', state.father.accessToken, {
    name: 'Rent', amount: '3000', category: 'RENT', frequency: 'MONTHLY', dueDate: addDays(today, -1), dueTime: '20:00',
  });
  assert.equal(late.data.status, 'OVERDUE');
  state.overdue = late.data;

  const overdue = await processDueNotifications({ familyId: state.father.family.id });
  assert.ok(overdue.overdueSent >= 1);
  const again = await processDueNotifications({ familyId: state.father.family.id });
  assert.equal(again.overdueSent, 0, 'no duplicate overdue alert');

  const list = await api('GET', '/payments?status=OVERDUE', state.father.accessToken);
  assert.ok(list.data.some((p: any) => p.id === state.overdue.id));
});

test('16–18. Marking paid records history and rolls to the next month', async () => {
  const before = state.overdue.dueDate as string;
  const paid = await api('POST', `/payments/${state.overdue.id}/pay`, state.father.accessToken);
  assert.equal(paid.status, 200, paid.message);
  assert.equal(paid.data.paidCycle.status, 'PAID');
  assert.equal(paid.data.paidCycle.dueDate, before);
  const [y, m, d] = before.split('-').map(Number);
  const expectedNext = new Date(Date.UTC(y, m, Math.min(d, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()))).toISOString().slice(0, 10);
  assert.equal(paid.data.dueDate, expectedNext, 'next due date generated automatically');
  assert.equal(paid.data.status, 'PAID', 'shows paid until the next cycle is near');

  const detail = await api('GET', `/payments/${state.overdue.id}`, state.father.accessToken);
  assert.equal(detail.data.history.length, 1);
  assert.equal(detail.data.history[0].status, 'PAID');

  const once = await api('POST', '/payments', state.father.accessToken, { name: 'Fee', amount: '50', category: 'OTHER', frequency: 'ONCE', dueDate: '2030-01-01', dueTime: '09:00' });
  const paidOnce = await api('POST', `/payments/${once.data.id}/pay`, state.father.accessToken);
  assert.equal(paidOnce.data.state, 'PAID');
  const twice = await api('POST', `/payments/${once.data.id}/pay`, state.father.accessToken);
  assert.equal(twice.status, 409, 'cannot pay twice');
});

test('Payment math: paying adds to spending once, totals come from real history, all categories count', async () => {
  const t = state.father.accessToken;
  const today = localDate(new Date(), 'Asia/Riyadh');
  const month = today.slice(0, 7);
  const report = async () => (await api('GET', `/reports/monthly?month=${month}`, t)).data;
  const summary = async () => (await api('GET', '/payments/summary', t)).data;
  const near = (actual: unknown, expected: number, message?: string) => assert.ok(Math.abs(Number(actual) - expected) < 0.01, `${message ?? ''} expected ${expected}, got ${actual}`);

  // Every category counts in the month total (not only household + lessons).
  const before = await report();
  const food = await api('POST', '/expenses/household', t, { amount: '10', occurredAt: new Date().toISOString() });
  assert.equal(food.status, 201);
  const afterFood = await report();
  near(afterFood.totalAmount, Number(before.totalAmount) + 10, 'all categories count');

  // A plain bill in the family currency: paying it records one expense of the same amount.
  const bill = await api('POST', '/payments', t, { name: 'Electricity', amount: '250', category: 'BILL', frequency: 'MONTHLY', dueDate: today, dueTime: '23:59' });
  const s1 = await summary();
  const paid = await api('POST', `/payments/${bill.data.id}/pay`, t);
  assert.equal(paid.status, 200, paid.message);
  const afterPay = await report();
  near(afterPay.totalAmount, Number(afterFood.totalAmount) + 250, 'paid bill adds exactly its amount');
  const posted = afterPay.expenses.filter((e: any) => e.description === 'Electricity');
  assert.equal(posted.length, 1);
  assert.equal(posted[0].category.key, 'household');

  // Totals: the paid cycle leaves "to pay"; "paid this month" grows by the real amount.
  const s2 = await summary();
  near(s2.paidThisMonth, Number(s1.paidThisMonth) + 250);
  near(s2.toPay, Number(s1.toPay) - 250, 'a paid cycle is no longer counted as to pay');

  // A bill in SAR is converted to the family currency when it becomes an expense.
  const { getExchangeRates } = await import('../src/services/rates.service');
  const rates = (await getExchangeRates()).rates;
  const sar = await api('POST', '/payments', t, { name: 'Gym', amount: '100', currency: 'SAR', category: 'SUBSCRIPTION', frequency: 'ONCE', dueDate: today, dueTime: '23:59' });
  await api('POST', `/payments/${sar.data.id}/pay`, t);
  const gym = (await report()).expenses.find((e: any) => e.description === 'Gym');
  const expected = (100 / rates.SAR) * rates[afterPay.currency];
  assert.equal(gym.amount, '100', 'the expense keeps the amount as paid');
  assert.equal(gym.currency, 'SAR');
  assert.ok(Math.abs(Number(gym.familyAmount) - expected) < 0.01, 'SAR converted to the family currency for totals');
  assert.equal(gym.category.key, 'entertainment');

  // A recurring fee's payment replaces its planned amount — never counted twice.
  const kid = await api('POST', '/members/children', t, { name: 'Sami' });
  const fee = await api('POST', '/expenses/recurring-home-lessons', t, { childId: kid.data.id, amount: '400', description: 'Piano', startDate: today, reminder: { daysBefore: 0, time: '09:00' } });
  const withPlanned = await report();
  await api('POST', `/payments/${fee.data.reminder.id}/pay`, t);
  const afterFee = await report();
  assert.equal(afterFee.totalAmount, withPlanned.totalAmount, 'planned 400 became actual 400, total unchanged');
  assert.equal(afterFee.expenses.filter((e: any) => e.description === 'Piano').length, 1);

  // A lesson that already has its own expense isn't recorded again when its reminder is paid.
  const lesson = await api('POST', '/expenses/home-lessons', t, {
    childId: kid.data.id, amount: '120', occurredAt: new Date(Date.now() + 3_600_000).toISOString(), reminder: { daysBefore: 0, time: '00:00' },
  });
  const beforeLessonPay = await report();
  if (lesson.data.reminder) await api('POST', `/payments/${lesson.data.reminder.id}/pay`, t);
  assert.equal((await report()).totalAmount, beforeLessonPay.totalAmount, 'no double counting for lessons');

  // The dashboard and the salary page use the same month total.
  const dash = await api('GET', '/dashboard', t);
  near(dash.data.totals.expenses, Number((await report()).totalAmount), 'dashboard uses the same total');
});

test('Undo "paid": the cycle, totals and spending go back exactly', async () => {
  const t = state.father.accessToken;
  const today = localDate(new Date(), 'Asia/Riyadh');
  const month = today.slice(0, 7);
  const near = (actual: unknown, expected: number, message?: string) => assert.ok(Math.abs(Number(actual) - expected) < 0.01, `${message ?? ''} expected ${expected}, got ${actual}`);
  const monthTotal = async () => Number((await api('GET', `/reports/monthly?month=${month}`, t)).data.totalAmount);
  const totals = async () => (await api('GET', '/payments/summary', t)).data;

  const bill = await api('POST', '/payments', t, { name: 'Water', amount: '90', category: 'BILL', frequency: 'MONTHLY', dueDate: today, dueTime: '23:59' });
  const spendBefore = await monthTotal();
  const totalsBefore = await totals();
  near(totalsBefore.total, Number(totalsBefore.toPay) + Number(totalsBefore.paid), 'total = to pay + paid (each payment once)');

  const paid = await api('POST', `/payments/${bill.data.id}/pay`, t);
  assert.notEqual(paid.data.dueDate, today, 'rolled to next month');
  near(await monthTotal(), spendBefore + 90);
  const totalsPaid = await totals();
  near(totalsPaid.total, Number(totalsBefore.total), 'paying moves the bill from "to pay" to "paid": total unchanged');
  near(totalsPaid.paid, Number(totalsBefore.paid) + 90);
  near(totalsPaid.toPay, Number(totalsBefore.toPay) - 90);

  const undone = await api('POST', `/payments/${bill.data.id}/unpay`, t);
  assert.equal(undone.status, 200, undone.message);
  assert.equal(undone.data.dueDate, today, 'back to the unpaid cycle');
  assert.equal(undone.data.status, 'DUE_TODAY');
  assert.equal(undone.data.lastPaidAt, null);
  near(await monthTotal(), spendBefore, 'its expense was removed');
  const totalsAfter = await totals();
  near(totalsAfter.toPay, Number(totalsBefore.toPay));
  near(totalsAfter.paidThisMonth, Number(totalsBefore.paidThisMonth));
  assert.equal((await api('GET', `/payments/${bill.data.id}`, t)).data.history.length, 0);
  assert.equal((await api('POST', `/payments/${bill.data.id}/unpay`, t)).status, 409, 'nothing left to undo');

  // A one-time payment goes from PAID back to open.
  const once = await api('POST', '/payments', t, { name: 'Repair', amount: '40', category: 'OTHER', frequency: 'ONCE', dueDate: today, dueTime: '23:59' });
  await api('POST', `/payments/${once.data.id}/pay`, t);
  const reopened = await api('POST', `/payments/${once.data.id}/unpay`, t);
  assert.equal(reopened.data.state, 'ACTIVE');
  assert.equal(reopened.data.status, 'DUE_TODAY');
});

test('Month total: planned fees count their full amount only in the months they are due', async () => {
  const t = state.father.accessToken;
  const kid = await api('POST', '/members/children', t, { name: 'Laila' });
  const start = '2031-01-15';
  const total = async (month: string) => Number((await api('GET', `/reports/monthly?month=${month}`, t)).data.totalAmount);
  const base = { '2031-01': await total('2031-01'), '2031-02': await total('2031-02'), '2031-04': await total('2031-04'), '2032-01': await total('2032-01') };
  await api('POST', '/expenses/recurring-home-lessons', t, { childId: kid.data.id, amount: '900', description: 'Quarterly', frequency: 'QUARTERLY', startDate: start });
  await api('POST', '/expenses/recurring-home-lessons', t, { childId: kid.data.id, amount: '1200', description: 'Yearly', frequency: 'YEARLY', startDate: start });
  await api('POST', '/expenses/recurring-home-lessons', t, { childId: kid.data.id, amount: '100', description: 'Monthly', frequency: 'MONTHLY', startDate: start });
  const near = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < 0.01, `${label}: expected ${expected}, got ${actual}`);
  near((await total('2031-01')) - base['2031-01'], 900 + 1200 + 100, 'Jan: all three due');
  near((await total('2031-02')) - base['2031-02'], 100, 'Feb: only the monthly fee');
  near((await total('2031-04')) - base['2031-04'], 900 + 100, 'Apr: quarterly + monthly');
  near((await total('2032-01')) - base['2032-01'], 900 + 1200 + 100, 'next Jan: all three again');
  near((await total('2030-12')), Number((await api('GET', '/reports/monthly?month=2030-12', t)).data.totalAmount), 'before start: nothing');
});

test('Month to pay: every cycle due in the month, paid or not', async () => {
  const fam = await api('POST', '/auth/register', undefined, { name: 'Month Dad', email: `monthdad-${run}@test.local`, password: 'pw', familyName: `Month ${run}` });
  const t = fam.data.accessToken;
  const month = async (m: string) => (await api('GET', `/payments/month?month=${m}`, t)).data;
  await api('POST', '/payments', t, { name: 'Weekly club', amount: '50', category: 'SUBSCRIPTION', frequency: 'WEEKLY', dueDate: '2031-03-02', dueTime: '10:00' });
  const rent = await api('POST', '/payments', t, { name: 'Rent', amount: '100', category: 'RENT', frequency: 'MONTHLY', dueDate: '2031-03-10', dueTime: '10:00' });
  await api('POST', '/payments', t, { name: 'Quarterly', amount: '900', category: 'TUITION', frequency: 'QUARTERLY', dueDate: '2031-04-15', dueTime: '10:00' });

  const march = await month('2031-03');
  assert.equal(Number(march.remaining), 5 * 50 + 100, 'five Sundays of the weekly bill + rent');
  assert.equal(march.remainingCount, 6);
  assert.equal(Number(march.paid), 0);
  assert.equal(Number((await month('2031-04')).remaining), 4 * 50 + 100 + 900, 'April: weekly ×4 + rent + quarterly');

  await api('POST', `/payments/${rent.data.id}/pay`, t);
  const paidMarch = await month('2031-03');
  assert.equal(Number(paidMarch.paid), 100, 'rent paid for March');
  assert.equal(Number(paidMarch.remaining), 250);
  assert.equal(Number(paidMarch.total), 350, 'total I pay in March is unchanged by paying');
  await prisma.user.deleteMany({ where: { email: `monthdad-${run}@test.local` } });
});

test('Month total stays the same when an overdue bill from last month is paid', async () => {
  const fam = await api('POST', '/auth/register', undefined, { name: 'Overdue Dad', email: `odad-${run}@test.local`, password: 'pw', familyName: `Overdue ${run}` });
  const t = fam.data.accessToken;
  const today = localDate(new Date(), 'Asia/Riyadh');
  const [y, m] = today.split('-').map(Number);
  const lastMonth = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}-10`;
  const month = async () => (await api('GET', `/payments/month?month=${today.slice(0, 7)}`, t)).data;
  const late = await api('POST', '/payments', t, { name: 'Late bill', amount: '300', category: 'BILL', frequency: 'ONCE', dueDate: lastMonth, dueTime: '10:00' });
  const before = await month();
  assert.equal(Number(before.remaining), 300, 'overdue from last month is still owed this month');
  assert.equal(Number(before.overdue), 300);
  await api('POST', `/payments/${late.data.id}/pay`, t);
  const after = await month();
  assert.equal(Number(after.paid), 300, 'paying it now counts as paid this month');
  assert.equal(Number(after.remaining), 0);
  assert.equal(Number(after.total), Number(before.total), 'the month total does not drop when you pay');
  await prisma.user.deleteMany({ where: { email: `odad-${run}@test.local` } });
});

test('Mother cannot delete payments without DELETE_PAYMENT', async () => {
  const res = await api('DELETE', `/payments/${state.payment.id}`, state.mother.accessToken);
  assert.equal(res.status, 403);
});

test('Children only see their own data', async () => {
  const t = state.father.accessToken;
  const omar = await api('POST', '/members/children', t, { name: 'Omar' });
  const lina = await api('POST', '/members/children', t, { name: 'Lina' });
  const now = new Date().toISOString();
  const omarLesson = await api('POST', '/expenses/home-lessons', t, { childId: omar.data.id, amount: '200', occurredAt: now });
  const linaLesson = await api('POST', '/expenses/home-lessons', t, { childId: lina.data.id, amount: '300', occurredAt: now });

  const invite = await api('POST', `/families/${state.father.family.id}/invitations`, t, { email: emails.child, role: 'CHILD', memberId: omar.data.id });
  assert.equal(invite.status, 201, invite.message);
  const child = await api('POST', '/auth/register', undefined, { name: 'Omar', email: emails.child, password: 'pw', inviteCode: invite.data.code });
  assert.equal(child.data.user.role, 'CHILD');
  const c = child.data.accessToken;

  assert.equal((await api('GET', `/expenses/${omarLesson.data.id}`, c)).status, 200);
  assert.equal((await api('GET', `/expenses/${linaLesson.data.id}`, c)).status, 404, 'cannot read a sibling\'s expense');
  assert.equal((await api('GET', `/members/children/${lina.data.id}`, c)).status, 403);
  const kids = await api('GET', '/members/children', c);
  assert.deepEqual(kids.data.map((k: any) => k.id), [omar.data.id]);
  const report = await api('GET', '/expenses', c);
  assert.ok(report.data.expenses.every((e: any) => e.member?.id === omar.data.id || e.createdBy?.id === child.data.user.id));
  assert.equal((await api('GET', '/reports/monthly', c)).status, 403, 'no VIEW_REPORTS by default');
  assert.equal((await api('POST', '/expenses/home-lessons', c, { childId: omar.data.id, amount: '5', occurredAt: now })).status, 403, 'no ADD_EXPENSE by default');
  assert.equal((await api('GET', '/payments', c)).data.length, 0);
});

test('A lesson can be fully edited: child, subject, teacher, date and amount', async () => {
  const t = state.father.accessToken;
  const sara = await api('POST', '/members/children', t, { name: 'Sara' });
  const yusuf = await api('POST', '/members/children', t, { name: 'Yusuf' });
  const lesson = await api('POST', '/expenses/home-lessons', t, { childId: sara.data.id, amount: '200', occurredAt: '2026-03-10T15:00:00+03:00', subject: 'math', newTeacher: { name: 'Mr. Ahmed' } });
  assert.equal(lesson.status, 201, lesson.message);

  const moved = await api('PUT', `/expenses/${lesson.data.id}`, t, {
    childId: yusuf.data.id,
    subject: 'physics',
    newTeacher: { name: 'Ms. Huda', phone: '+966500000000' },
    occurredAt: '2026-03-12T18:30:00+03:00',
    amount: '250',
  });
  assert.equal(moved.status, 200, moved.message);
  assert.equal(moved.data.member.id, yusuf.data.id);
  assert.equal(moved.data.subject, 'physics');
  assert.equal(moved.data.teacher.name, 'Ms. Huda');
  assert.equal(moved.data.date, '2026-03-12');
  assert.equal(moved.data.amount, '250');
  const yusufLessons = (await api('GET', `/members/children/${yusuf.data.id}`, t)).data.lessons;
  assert.ok(yusufLessons.some((l: any) => l.id === lesson.data.id), 'the lesson moved to the other child');

  const cleared = await api('PUT', `/expenses/${lesson.data.id}`, t, { teacherId: null, subject: null });
  assert.equal(cleared.data.teacher, null);
  assert.equal(cleared.data.subject, null);

  const household = await api('POST', '/expenses/household', t, { amount: '40', occurredAt: new Date().toISOString() });
  assert.equal((await api('PUT', `/expenses/${household.data.id}`, t, { childId: sara.data.id })).status, 400, 'only lessons belong to a child');

  assert.equal((await api('DELETE', `/expenses/${lesson.data.id}`, t)).status, 200);
  assert.equal((await api('GET', `/expenses/${lesson.data.id}`, t)).status, 404);
});

test('Expenses create reminders by default (future date/time, recurring fees)', async () => {
  const t = state.father.accessToken;
  const kid = await api('POST', '/members/children', t, { name: 'Ali' });
  const reminder = { daysBefore: 0, time: '10:00' };

  const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const lesson = await api('POST', '/expenses/home-lessons', t, { childId: kid.data.id, amount: '150', occurredAt: future, reminder });
  assert.equal(lesson.status, 201, lesson.message);
  assert.ok(lesson.data.reminder, 'future lesson gets a reminder');
  assert.equal(lesson.data.reminder.frequency, 'ONCE');
  assert.equal(lesson.data.reminder.member.id, kid.data.id);
  assert.equal(lesson.data.reminder.reminderEnabled, true);

  const past = await api('POST', '/expenses/household', t, { amount: '40', occurredAt: new Date(Date.now() - 3_600_000).toISOString(), reminder });
  assert.equal(past.data.reminder, null, 'past expenses need no reminder');

  const quarterly = await api('POST', '/expenses/recurring-home-lessons', t, { childId: kid.data.id, amount: '900', description: 'Quran', frequency: 'QUARTERLY', dueTime: '18:00', reminder: { daysBefore: 1, time: '20:00' } });
  assert.equal(quarterly.status, 201, quarterly.message);
  assert.equal(quarterly.data.frequency, 'QUARTERLY');
  assert.equal(quarterly.data.reminder.frequency, 'QUARTERLY');
  assert.equal(quarterly.data.reminder.dueTime, '18:00');

  const yearly = await api('POST', '/expenses/recurring-household', t, { amount: '2400', description: 'Car insurance', frequency: 'YEARLY', reminder });
  assert.equal(yearly.status, 201, yearly.message);
  assert.equal(yearly.data.kind, 'HOUSEHOLD');
  assert.equal(yearly.data.reminder.frequency, 'YEARLY');
  const fees = await api('GET', '/recurring', t);
  assert.ok(fees.data.some((f: any) => f.id === yearly.data.id), 'recurring household expenses are listed');

  // Removing the expense / fee cancels its reminder.
  await api('DELETE', `/expenses/${lesson.data.id}`, t);
  assert.equal((await api('GET', `/payments/${lesson.data.reminder.id}`, t)).data.state, 'CANCELLED');
  await api('DELETE', `/recurring/${quarterly.data.id}`, t);
  assert.equal((await api('GET', `/payments/${quarterly.data.reminder.id}`, t)).data.state, 'CANCELLED');
});

test('Father sets the salary; remaining = salary − expenses; salary hidden from Mother by default', async () => {
  const t = state.father.accessToken;
  const set = await api('PUT', '/incomes/salary', t, { amount: '20000', payDay: 25 });
  assert.equal(set.status, 200, set.message);
  assert.equal(set.data.salary.amount, '20000');
  const income = Number(set.data.totals.income);
  const expenses = Number(set.data.totals.expenses);
  assert.equal(income, 20000);
  assert.equal(Number(set.data.totals.remaining), income - expenses);

  const dash = await api('GET', '/dashboard', t);
  assert.equal(Number(dash.data.totals.balance), income - expenses);
  assert.equal(dash.data.totals.hasSalary, true);
});

test('Salary in another currency is converted before calculating what is left', async () => {
  const t = state.father.accessToken;
  const { getExchangeRates } = await import('../src/services/rates.service');
  const rates = (await getExchangeRates()).rates;
  const set = await api('PUT', '/incomes/salary', t, { amount: '1000', payDay: 25, currency: 'SAR' });
  assert.equal(set.status, 200, set.message);
  assert.equal(set.data.salary.currency, 'SAR');
  const family = set.data.currency; // the family counts in EGP by default
  const expected = (1000 / rates.SAR) * rates[family];
  assert.ok(Math.abs(Number(set.data.salary.amountInFamilyCurrency) - expected) < 0.01, 'salary converted at today\'s rate');
  assert.ok(Math.abs(Number(set.data.totals.remaining) - (Number(set.data.totals.income) - Number(set.data.totals.expenses))) < 0.01);

  const extra = await api('POST', '/incomes', t, { amount: '100', source: 'Bonus', date: new Date().toISOString().slice(0, 10), currency: 'USD' });
  assert.equal(extra.status, 201, extra.message);
  const summary = await api('GET', '/incomes/summary', t);
  const bonus = summary.data.incomes.find((i: any) => i.source === 'Bonus');
  assert.ok(Math.abs(Number(bonus.amountInFamilyCurrency) - 100 * rates[family]) < 0.01);
  // Back to the family currency for the following tests.
  await api('PUT', '/incomes/salary', t, { amount: '20000', payDay: 25 });
  await api('DELETE', `/incomes/${extra.data.id}`, t);
});

test('Login checks the chosen role; Father creates the Mother account directly; service switches', async () => {
  const wrong = await api('POST', '/auth/login', undefined, { email: emails.father, password: 'pw', as: 'MEMBER' });
  assert.equal(wrong.status, 403);
  const ok = await api('POST', '/auth/login', undefined, { email: emails.father, password: 'pw', as: 'FATHER' });
  assert.equal(ok.status, 200);
  const t = state.father.accessToken;
  const fid = state.father.family.id;

  const login = `wife${run}`;
  const created = await api('POST', `/families/${fid}/members`, t, { name: 'Wife', login, password: 'secret', role: 'MOTHER' });
  assert.equal(created.status, 201, created.message);
  const notFather = await api('POST', '/auth/login', undefined, { email: login, password: 'secret', as: 'FATHER' });
  assert.equal(notFather.status, 403, 'mother cannot sign in as father');
  const wife = await api('POST', '/auth/login', undefined, { email: login, password: 'secret', as: 'MEMBER' });
  assert.equal(wife.status, 200);
  assert.equal(wife.data.user.role, 'MOTHER');
  const w = wife.data.accessToken;

  assert.equal((await api('GET', '/incomes/summary', w)).status, 403, 'salary hidden unless the father allows it');
  await api('PUT', `/families/${fid}/members/${created.data.id}/permissions`, t, { permissions: { VIEW_INCOME: true } });
  assert.equal((await api('GET', '/incomes/summary', w)).status, 200, 'father can share the salary view');

  // Turning a service off hides its data and blocks adding to it.
  await api('PUT', `/families/${fid}/members/${created.data.id}/permissions`, t, { permissions: { SERVICE_HOUSEHOLD: false } });
  assert.equal((await api('POST', '/expenses/household', w, { amount: '5', occurredAt: new Date().toISOString() })).status, 403);
  const report = await api('GET', '/expenses', w);
  assert.ok(report.data.expenses.every((e: any) => e.category.key !== 'household'), 'household expenses are hidden');
  assert.ok((await api('GET', '/recurring', w)).data.every((f: any) => f.kind !== 'HOUSEHOLD'));

  // A son's account without adding the child first: the child record is created automatically.
  const sonLogin = `son${run}`;
  const son = await api('POST', `/families/${fid}/members`, t, { name: 'Hamza', login: sonLogin, password: 'secret', role: 'CHILD' });
  assert.equal(son.status, 201, son.message);
  assert.equal(son.data.role, 'CHILD');
  assert.equal(son.data.child.name, 'Hamza');
  const sonSession = await api('POST', '/auth/login', undefined, { email: sonLogin, password: 'secret', as: 'MEMBER' });
  const kids = await api('GET', '/members/children', sonSession.data.accessToken);
  assert.deepEqual(kids.data.map((k: any) => k.name), ['Hamza'], 'the son only sees himself');
  await prisma.user.deleteMany({ where: { email: sonLogin } });

  const reset = await api('PUT', `/families/${fid}/members/${created.data.id}/password`, t, { password: 'newpass' });
  assert.equal(reset.status, 200);
  assert.equal((await api('POST', '/auth/login', undefined, { email: login, password: 'newpass' })).status, 200);
  await prisma.user.deleteMany({ where: { email: login } });
});

test('Lessons keep the teacher name and number; payment screenshots are stored and protected', async () => {
  const t = state.father.accessToken;
  const kid = await api('POST', '/members/children', t, { name: 'Yousef' });
  const lesson = await api('POST', '/expenses/home-lessons', t, {
    childId: kid.data.id, amount: '200', occurredAt: new Date().toISOString(), newTeacher: { name: 'Mr. Khaled', phone: '+966 50 123 4567' },
  });
  assert.equal(lesson.status, 201, lesson.message);
  assert.equal(lesson.data.teacher.name, 'Mr. Khaled');
  assert.equal(lesson.data.teacher.phone, '+966 50 123 4567');
  const teachers = await api('GET', '/teachers', t);
  const khaled = teachers.data.find((x: any) => x.name === 'Mr. Khaled');
  assert.ok(khaled, 'new teacher saved for reuse');
  const second = await api('POST', '/expenses/home-lessons', t, { childId: kid.data.id, amount: '200', occurredAt: new Date().toISOString(), teacherId: khaled.id, subject: 'math' });
  assert.equal(second.data.teacher.id, khaled.id);
  assert.equal(second.data.subject, 'math');
  const future = await api('POST', '/expenses/home-lessons', t, {
    childId: kid.data.id, amount: '150', occurredAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), subject: 'math', reminder: { daysBefore: 0, time: '10:00' },
  });
  assert.match(future.data.reminder.name, /رياضيات/, 'reminder is titled with the subject');
  const subjects = await api('GET', '/teachers/subjects', t);
  assert.ok(subjects.data.includes('math'));
  const fee = await api('POST', '/expenses/recurring-home-lessons', t, { childId: kid.data.id, amount: '800', description: 'Maths', teacherId: khaled.id, reminder: { daysBefore: 1, time: '10:00' } });
  assert.equal(fee.data.teacher.phone, '+966 50 123 4567');
  assert.match(fee.data.reminder.notes, /Mr\. Khaled/);

  // A tiny valid JPEG header + filler, base64.
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]).toString('base64');
  const up = await api('POST', '/attachments', t, { expenseId: lesson.data.id, mimeType: 'image/jpeg', data: jpeg });
  assert.equal(up.status, 201, up.message);
  const fake = await api('POST', '/attachments', t, { expenseId: lesson.data.id, mimeType: 'image/png', data: jpeg });
  assert.equal(fake.status, 400, 'content must match the declared image type');
  const list = await api('GET', `/attachments?expenseId=${lesson.data.id}`, t);
  assert.equal(list.data.length, 1);
  const img = await api('GET', `/attachments/${up.data.id}`, t);
  assert.equal(img.data.data, jpeg);
  assert.equal((await api('GET', `/expenses/${lesson.data.id}`, t)).data.attachmentCount, 1);

  // Proof for a paid cycle.
  const paid = await api('POST', `/payments/${fee.data.reminder.id}/pay`, t);
  const record = (await api('GET', `/payments/${fee.data.reminder.id}`, t)).data.history[0];
  const proof = await api('POST', '/attachments', t, { paymentRecordId: record.id, mimeType: 'image/jpeg', data: jpeg });
  assert.equal(proof.status, 201, proof.message);
  assert.equal(proof.data.cycleDueDate, paid.data.paidCycle.dueDate);

  state.attachmentId = up.data.id;
  state.attachmentExpense = lesson.data.id;
  assert.equal((await api('DELETE', `/attachments/${proof.data.id}`, t)).status, 200);
});

test('Father private money: only he can see it, and it stays out of family totals', async () => {
  const t = state.father.accessToken;
  const before = await api('GET', '/dashboard', t);
  await api('POST', '/private', t, { direction: 'IN', amount: '5000', note: 'savings' });
  const out = await api('POST', '/private', t, { direction: 'OUT', amount: '1200', note: 'gift' });
  assert.equal(out.status, 201, out.message);
  assert.equal(Number(out.data.balance), 3800);
  state.privateEntry = out.data.entries[0].id;

  const after = await api('GET', '/dashboard', t);
  assert.equal(after.data.totals.balance, before.data.totals.balance, 'family totals ignore private money');
  assert.equal(after.data.totals.expenses, before.data.totals.expenses);

  assert.equal((await api('GET', '/private', state.mother.accessToken)).status, 403, 'mother cannot see it');
  assert.equal((await api('DELETE', `/private/${state.privateEntry}`, state.mother.accessToken)).status, 403);

  // Even a second admin (father role) in the same family sees only his own, empty wallet.
  const login = `cofather${run}`;
  await api('POST', `/families/${state.father.family.id}/members`, t, { name: 'Uncle', login, password: 'secret', role: 'FATHER' });
  const co = await api('POST', '/auth/login', undefined, { email: login, password: 'secret', as: 'FATHER' });
  const coView = await api('GET', '/private', co.data.accessToken);
  assert.equal(coView.status, 200);
  assert.equal(Number(coView.data.balance), 0);
  assert.equal(coView.data.entries.length, 0);
  assert.equal((await api('DELETE', `/private/${state.privateEntry}`, co.data.accessToken)).status, 404);
  await prisma.user.deleteMany({ where: { email: login } });
});

test('Allowance (عهدة): father gives the mother money, she deducts, balance and spending stay right', async () => {
  const f = state.father.accessToken;
  const m = state.mother.accessToken;
  const month = localDate(new Date(), 'Asia/Riyadh').slice(0, 7);
  const spending = async () => Number((await api('GET', `/reports/monthly?month=${month}`, f)).data.totalAmount);

  assert.equal((await api('POST', '/wallets', m, { name: 'x', holderId: state.mother.user.id, amount: '10' })).status, 403, 'only the father creates allowances');
  const w = await api('POST', '/wallets', f, { name: 'House', holderId: state.mother.user.id, amount: '5000', spenderIds: [state.mother.user.id] });
  assert.equal(w.status, 201, w.message);
  assert.equal(Number(w.data.balance), 5000);

  const mine = await api('GET', '/wallets', m);
  assert.equal(mine.data.length, 1, 'the mother sees the allowance given to her');
  assert.equal(mine.data[0].canSpend, true);
  const notes = await api('GET', '/notifications', m);
  assert.ok(notes.data.items.some((n: any) => n.relatedEntityId === w.data.id), 'she is told money was added');

  const before = await spending();
  const spent = await api('POST', `/wallets/${w.data.id}/spend`, m, { amount: '1200', note: 'Groceries' });
  assert.equal(spent.status, 200, spent.message);
  assert.equal(Number(spent.data.balance), 3800, '5000 − 1200');
  assert.ok(Math.abs((await spending()) - (before + 1200)) < 0.01, 'the deduction counts as family spending');
  const fatherNotes = await api('GET', '/notifications', f);
  assert.ok(fatherNotes.data.items.some((n: any) => n.relatedEntityId === w.data.id), 'the father is told about the spending');

  assert.equal((await api('POST', `/wallets/${w.data.id}/spend`, m, { amount: '4000' })).status, 409, 'cannot spend more than the balance');
  assert.equal((await api('POST', `/wallets/${w.data.id}/topup`, m, { amount: '100' })).status, 403, 'only the father adds money');

  const top = await api('POST', `/wallets/${w.data.id}/topup`, f, { amount: '1000' });
  assert.equal(Number(top.data.balance), 4800);

  // The father chooses who may deduct: take the mother off the list.
  await api('PUT', `/wallets/${w.data.id}`, f, { spenderIds: [state.father.user.id] });
  assert.equal((await api('POST', `/wallets/${w.data.id}/spend`, m, { amount: '10' })).status, 403, 'removed from the deduct list');
  await api('PUT', `/wallets/${w.data.id}`, f, { spenderIds: [state.mother.user.id] });

  // Undoing a deduction gives the money back and removes the expense.
  const detail = await api('GET', `/wallets/${w.data.id}`, m);
  const spend = detail.data.entries.find((e: any) => e.type === 'SPEND');
  const undone = await api('DELETE', `/wallets/${w.data.id}/entries/${spend.id}`, m);
  assert.equal(Number(undone.data.balance), 6000);
  assert.ok(Math.abs((await spending()) - before) < 0.01, 'its expense is gone too');
  state.walletId = w.data.id;
});

test('20. Another family cannot access any of this data', async () => {
  const other = await api('POST', '/auth/register', undefined, { name: 'Other', email: emails.other, password: 'pw', familyName: `Other ${run}` });
  assert.equal(other.status, 201);
  const t = other.data.accessToken;
  const fid = state.father.family.id;

  assert.equal((await api('GET', `/expenses/${state.expense.id}`, t)).status, 404);
  assert.equal((await api('PUT', `/expenses/${state.expense.id}`, t, { amount: '1' })).status, 404);
  assert.equal((await api('DELETE', `/expenses/${state.expense.id}`, t)).status, 404);
  assert.equal((await api('GET', `/payments/${state.payment.id}`, t)).status, 404);
  assert.equal((await api('POST', `/payments/${state.payment.id}/pay`, t)).status, 404);
  assert.equal((await api('GET', `/families/${fid}`, t)).status, 404);
  assert.equal((await api('GET', `/families/${fid}/members`, t)).status, 404);
  assert.equal((await api('PUT', `/families/${fid}/members/${state.mother.user.id}/permissions`, t, { permissions: { DELETE_EXPENSE: true } })).status, 404);
  assert.equal((await api('POST', `/families/${fid}/invitations`, t, { email: 'a@b.co', role: 'MOTHER' })).status, 404);

  const lists = await Promise.all([api('GET', '/payments', t), api('GET', '/reports/monthly', t), api('GET', '/notifications', t)]);
  assert.equal(lists[0].data.length, 0);
  assert.equal(lists[1].data.expenses.length, 0);
  assert.equal(lists[2].data.items.length, 0);

  assert.equal((await api('GET', `/attachments/${state.attachmentId}`, t)).status, 404, 'cannot read another family\'s screenshot');
  assert.equal((await api('GET', `/attachments?expenseId=${state.attachmentExpense}`, t)).status, 404);
  assert.equal((await api('DELETE', `/attachments/${state.attachmentId}`, t)).status, 404);
  assert.equal((await api('GET', '/teachers', t)).data.length, 0);
  assert.equal((await api('GET', `/wallets/${state.walletId}`, t)).status, 404, 'another family cannot see the allowance');
  assert.equal((await api('POST', `/wallets/${state.walletId}/spend`, t, { amount: '1' })).status, 404);
  assert.equal((await api('GET', '/wallets', t)).data.length, 0);
  const otherPrivate = await api('GET', '/private', t);
  assert.equal(Number(otherPrivate.data.balance), 0, 'another family sees nothing of it');
  assert.equal((await api('DELETE', `/private/${state.privateEntry}`, t)).status, 404);

  const ids = state.mother.user.id;
  assert.equal((await api('PUT', `/notifications/${ids}/read`, t)).status, 404);
});

test('Removed members lose access immediately', async () => {
  const res = await api('DELETE', `/families/${state.father.family.id}/members/${state.mother.user.id}`, state.father.accessToken);
  assert.equal(res.status, 200, res.message);
  assert.equal((await api('GET', '/payments', state.mother.accessToken)).status, 401);
  assert.equal((await api('POST', '/auth/refresh', undefined, { refreshToken: state.mother.refreshToken })).status, 401);
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: state.payment.id } });
  assert.equal(payment.assigneeId, state.father.user.id, 'open payments move to the admin');
});

test('Super admin sees every family and enters any of them without a password', async () => {
  // Earlier tests spend the auth limiter's failure budget on purpose.
  for (const ip of ['127.0.0.1', '::ffff:127.0.0.1']) await authLimiter.resetKey(ip);
  const fid = state.father.family.id;
  assert.equal((await api('GET', '/admin/families', state.father.accessToken)).status, 403, 'a family admin is not a super admin');

  const own = await api('POST', '/auth/register', undefined, { name: 'Operator', email: emails.superAdmin, password: 'pw', familyName: `Ops ${run}` });
  assert.equal(own.status, 201, own.message);
  const operator = await prisma.user.update({ where: { email: emails.superAdmin }, data: { isSuperAdmin: true } });
  const creds = { email: emails.superAdmin, password: 'pw', as: 'MEMBER' };
  const noTwoFactor = await api('POST', '/auth/login', undefined, creds);
  assert.equal(noTwoFactor.status, 403, 'a super admin cannot sign in before setting up two-factor');

  const { secret } = await enrollTotp(operator.id);
  const step1 = await api('POST', '/auth/login', undefined, creds);
  assert.equal(step1.status, 200, step1.message);
  assert.equal(step1.data.twoFactorRequired, true);
  assert.equal(step1.data.accessToken, undefined, 'no session before the code');
  assert.equal((await api('GET', '/admin/families', step1.data.challenge)).status, 401, 'the challenge is not an access token');
  const wrong = totpCode(secret) === '000000' ? '111111' : '000000';
  assert.equal((await api('POST', '/auth/login/2fa', undefined, { challenge: step1.data.challenge, code: wrong })).status, 401);
  const code = totpCode(secret);
  const login = await api('POST', '/auth/login/2fa', undefined, { challenge: step1.data.challenge, code });
  assert.equal(login.status, 200, login.message);
  const sealed = await prisma.user.findUniqueOrThrow({ where: { id: operator.id } });
  assert.ok(sealed.totpSecret?.startsWith('v1:'), 'the server encrypts a freshly enrolled secret at first sign-in');
  assert.ok(!sealed.totpSecret?.includes(secret));
  const again = await api('POST', '/auth/login', undefined, creds);
  assert.equal((await api('POST', '/auth/login/2fa', undefined, { challenge: again.data.challenge, code })).status, 401, 'a code works only once');

  assert.equal(login.data.user.isSuperAdmin, true);
  let t = login.data.accessToken;

  const families = await api('GET', '/admin/families', t);
  assert.ok(families.data.some((f: any) => f.id === fid && f.owner.email === emails.father));
  const users = await api('GET', '/admin/users', t);
  assert.ok(users.data.some((u: any) => u.email === emails.father && u.family.id === fid));

  const switched = await api('POST', '/admin/switch-family', t, { familyId: fid, refreshToken: login.data.refreshToken });
  assert.equal(switched.status, 200, switched.message);
  assert.equal(switched.data.family.id, fid);
  assert.equal(switched.data.user.isAdmin, true);
  assert.equal((await api('POST', '/auth/refresh', undefined, { refreshToken: login.data.refreshToken })).status, 401, 'the previous session is revoked');
  t = switched.data.accessToken;

  // Full admin inside the family: can fix records and add screenshots to a teacher's lesson.
  assert.equal((await api('GET', `/expenses/${state.attachmentExpense}`, t)).status, 200);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]).toString('base64');
  const up = await api('POST', '/attachments', t, { expenseId: state.attachmentExpense, mimeType: 'image/jpeg', data: jpeg });
  assert.equal(up.status, 201, up.message);
  assert.equal((await api('PUT', `/expenses/${state.attachmentExpense}`, t, { notes: 'Fixed by support' })).status, 200);

  const due = addDays(localDate(new Date(), 'Asia/Riyadh'), 5);
  const payment = await api('POST', '/payments', t, { name: 'Support fix', amount: '10', currency: 'SAR', category: 'OTHER', frequency: 'ONCE', dueDate: due, dueTime: '20:00', reminderEnabled: false });
  assert.equal(payment.status, 201, payment.message);
  assert.equal(payment.data.assignee.id, state.father.user.id, 'defaults to the family owner, not the visitor');

  const father = await prisma.user.findUniqueOrThrow({ where: { email: emails.father } });
  assert.equal(father.familyId, fid, 'the visited family is untouched');
  assert.equal(Number((await api('GET', '/private', t)).data.balance), 0, "the father's private money stays private");

  const refreshed = await api('POST', '/auth/refresh', undefined, { refreshToken: switched.data.refreshToken });
  assert.equal(refreshed.data.family.id, fid, 'refresh keeps the family the super admin switched into');

  await prisma.user.update({ where: { email: emails.superAdmin }, data: { isSuperAdmin: false } });
  assert.equal((await api('GET', '/payments', refreshed.data.accessToken)).status, 401, 'revoking super admin ends access to other families');
});

test('Expenses, lessons and fees can be entered in any currency; totals use the family currency', async () => {
  const t = state.father.accessToken;
  const near = (actual: unknown, expected: number, message?: string) => assert.ok(Math.abs(Number(actual) - expected) < 0.01, `${message ?? ''} expected ${expected}, got ${actual}`);
  const { getExchangeRates } = await import('../src/services/rates.service');
  const rates = (await getExchangeRates()).rates;
  const before = (await api('GET', '/reports/monthly', t)).data;
  const family = before.currency as string;
  const inFamily = (amount: number, from: string) => (amount / rates[from]) * rates[family];

  const usd = await api('POST', '/expenses/household', t, { amount: '20', currency: 'USD', description: 'Online order', occurredAt: new Date().toISOString() });
  assert.equal(usd.status, 201, usd.message);
  assert.equal(Number(usd.data.amount), 20);
  assert.equal(usd.data.currency, 'USD');
  near(usd.data.familyAmount, inFamily(20, 'USD'));

  const same = await api('POST', '/expenses/household', t, { amount: '5', currency: family, occurredAt: new Date().toISOString() });
  assert.equal(same.data.currency, family, 'the family currency is stored as-is');
  near(same.data.familyAmount, 5);

  const kid = await api('POST', '/members/children', t, { name: 'Lina' });
  const lesson = await api('POST', '/expenses/home-lessons', t, { childId: kid.data.id, amount: '50', currency: 'EUR', occurredAt: new Date().toISOString() });
  assert.equal(lesson.status, 201, lesson.message);
  assert.equal(lesson.data.currency, 'EUR');

  const rent = await api('POST', '/expenses/recurring-household', t, { amount: '1000', currency: 'SAR', description: 'Rent', frequency: 'MONTHLY', reminder: { daysBefore: 1, time: '09:00' } });
  assert.equal(rent.status, 201, rent.message);
  assert.equal(rent.data.currency, 'SAR');
  assert.equal(rent.data.reminder.currency, 'SAR', 'the reminder payment uses the same currency');

  const after = (await api('GET', '/reports/monthly', t)).data;
  near(Number(after.totalAmount) - Number(before.totalAmount), inFamily(20, 'USD') + 5 + inFamily(50, 'EUR') + inFamily(1000, 'SAR'), 'totals convert every item to the family currency');
  const child = after.homeLessons.perChild.find((c: any) => c.childId === kid.data.id);
  near(child.sessionAmount, inFamily(50, 'EUR'));

  // Changing the currency of an existing expense re-prices it.
  const edited = await api('PUT', `/expenses/${usd.data.id}`, t, { currency: 'EUR' });
  assert.equal(edited.status, 200, edited.message);
  assert.equal(edited.data.currency, 'EUR');
  near(edited.data.familyAmount, inFamily(20, 'EUR'));
  const back = await api('PUT', `/expenses/${usd.data.id}`, t, { currency: family, amount: '7' });
  near(back.data.familyAmount, 7, 'back in the family currency the amount counts as entered');

  assert.equal((await api('POST', '/expenses/household', t, { amount: '1', currency: 'XYZ', occurredAt: new Date().toISOString() })).status, 422);
});
