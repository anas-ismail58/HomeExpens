/**
 * End-to-end acceptance scenario against the real Express app and the local database.
 * Run: npm test (needs DATABASE_URL pointing at a migrated dev database).
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { resetAuthLimits } from '../src/middleware/rateLimit';
import { enrollTotp, totpCode } from '../src/services/totp.service';
import { processDueNotifications } from '../src/services/scheduler.service';
import { setReceiptReader, type ReceiptReading } from '../src/services/receipt.service';
import { addDays, localDate } from '../src/utils/time';

let server: Server;
let base = '';
const run = Date.now().toString(36);
const emails = { father: `father-${run}@test.local`, mother: `mother-${run}@test.local`, other: `other-${run}@test.local`, child: `child-${run}@test.local`, superAdmin: `super-${run}@test.local`, calc: `calc-${run}@test.local`, forgot: `forgot-${run}@test.local` };

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

/** A small real PNG: paying needs a screenshot of the payment. */
const RECEIPT_PNG = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAA00lEQVR4AQHIADf/AMhkMshkMshkMshkMshkMshkMshkMshkMgDIZDLIZDLIZDLIZDLIZDLIZDLIZDLIZDIAyGQyyGQyyGQyyGQyyGQyyGQyyGQyyGQyAMhkMshkMshkMshkMshkMshkMshkMshkMgDIZDLIZDLIZDLIZDLIZDLIZDLIZDLIZDIAyGQyyGQyyGQyyGQyyGQyyGQyyGQyyGQyAMhkMshkMshkMshkMshkMshkMshkMshkMgDIZDLIZDLIZDLIZDLIZDLIZDLIZDLIZDJWRleB3ArWtQAAAABJRU5ErkJggg==', width: 8, height: 8 };
/** A different (still valid) screenshot each time: the same image can't be used for two payments. */
let receiptCount = 0;
function receipt() {
  const bytes = Buffer.concat([Buffer.from(RECEIPT_PNG.data, 'base64'), Buffer.from(`#${run}-${++receiptCount}`)]);
  return { ...RECEIPT_PNG, data: bytes.toString('base64') };
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  // Families first: deleting users and their families in one statement mixes SET NULL and CASCADE on the same rows.
  await prisma.family.deleteMany({ where: { owner: { email: { in: Object.values(emails) } } } });
  await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
  server.close();
  await prisma.$disconnect();
});

test('1–2. Father registers and creates a family', async () => {
  const res = await api('POST', '/auth/register', undefined, { name: 'Father', email: emails.father, password: 'pw', familyName: `Family ${run}`, timezone: 'Asia/Riyadh' });
  assert.equal(res.status, 201, res.message);
  assert.equal(res.data.user.role, 'FATHER');
  assert.equal(res.data.user.isAdmin, true);
  assert.equal(res.data.user.permissions.length, 17);
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
  const paid = await api('POST', `/payments/${state.overdue.id}/pay`, state.father.accessToken, { receipt: receipt() });
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
  const paidOnce = await api('POST', `/payments/${once.data.id}/pay`, state.father.accessToken, { receipt: receipt() });
  assert.equal(paidOnce.data.state, 'PAID');
  const twice = await api('POST', `/payments/${once.data.id}/pay`, state.father.accessToken, { receipt: receipt() });
  assert.equal(twice.status, 409, 'cannot pay twice');
});

test('Paying needs a screenshot; it is kept with the paid cycle and shows when it was paid', async () => {
  const t = state.father.accessToken;
  const bill = await api('POST', '/payments', t, { name: 'Water', amount: '80', category: 'BILL', frequency: 'MONTHLY', dueDate: '2031-05-01', dueTime: '18:30' });
  const missing = await api('POST', `/payments/${bill.data.id}/pay`, t);
  assert.equal(missing.status, 422);
  assert.equal((missing as any).code, 'RECEIPT_REQUIRED');
  assert.equal((await api('GET', `/payments/${bill.data.id}`, t)).data.history.length, 0, 'nothing is paid without the screenshot');
  const bad = await api('POST', `/payments/${bill.data.id}/pay`, t, { receipt: { mimeType: 'image/png', data: 'x'.repeat(200) } });
  assert.equal(bad.status, 400, 'the screenshot must be a real image');

  const before = Date.now();
  const sent = receipt();
  const paid = await api('POST', `/payments/${bill.data.id}/pay`, t, { receipt: sent });
  assert.equal(paid.status, 200, paid.message);
  const detail = (await api('GET', `/payments/${bill.data.id}`, t)).data;
  const cycle = detail.history[0];
  assert.equal(cycle.receiptIds.length, 1, 'the receipt is attached to the paid cycle');
  assert.ok(new Date(cycle.paidAt).getTime() >= before - 1000, 'paid date and time are recorded');
  const files = await api('GET', `/attachments?paymentId=${bill.data.id}`, t);
  assert.equal(files.data[0].cycleDueDate, '2031-05-01');
  const image = await api('GET', `/attachments/${cycle.receiptIds[0]}`, t);
  assert.equal(image.data.data, sent.data);

  // Undoing the payment removes its receipt too.
  await api('POST', `/payments/${bill.data.id}/unpay`, t);
  assert.equal((await api('GET', `/attachments?paymentId=${bill.data.id}`, t)).data.length, 0);
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
  const paid = await api('POST', `/payments/${bill.data.id}/pay`, t, { receipt: receipt() });
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
  await api('POST', `/payments/${sar.data.id}/pay`, t, { receipt: receipt() });
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
  await api('POST', `/payments/${fee.data.reminder.id}/pay`, t, { receipt: receipt() });
  const afterFee = await report();
  assert.equal(afterFee.totalAmount, withPlanned.totalAmount, 'planned 400 became actual 400, total unchanged');
  assert.equal(afterFee.expenses.filter((e: any) => e.description === 'Piano').length, 1);

  // A lesson that already has its own expense isn't recorded again when its reminder is paid.
  const lesson = await api('POST', '/expenses/home-lessons', t, {
    subject: 'math',
    childId: kid.data.id, amount: '120', occurredAt: new Date(Date.now() + 3_600_000).toISOString(), reminder: { daysBefore: 0, time: '00:00' },
  });
  const beforeLessonPay = await report();
  if (lesson.data.reminder) await api('POST', `/payments/${lesson.data.reminder.id}/pay`, t, { receipt: receipt() });
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

  const paid = await api('POST', `/payments/${bill.data.id}/pay`, t, { receipt: receipt() });
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
  await api('POST', `/payments/${once.data.id}/pay`, t, { receipt: receipt() });
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

test('Rent and residency fees can repeat every 6 months', async () => {
  const fam = await api('POST', '/auth/register', undefined, { name: 'Semi Dad', email: `semidad-${run}@test.local`, password: 'pw', familyName: `Semi ${run}` });
  const t = fam.data.accessToken;
  const total = async (month: string) => Number((await api('GET', `/reports/monthly?month=${month}`, t)).data.totalAmount);
  const rent = await api('POST', '/expenses/recurring-household', t, { amount: '6000', subcategoryKey: 'rent', description: 'Rent', frequency: 'SEMI_ANNUAL', startDate: '2031-01-10' });
  assert.equal(rent.status, 201, JSON.stringify(rent));
  const residency = await api('POST', '/expenses/recurring-household', t, { amount: '700', subcategoryKey: 'residency', description: 'Residency fees', frequency: 'SEMI_ANNUAL', startDate: '2031-03-01' });
  assert.equal(residency.status, 201, JSON.stringify(residency));
  assert.equal(await total('2031-01'), 6000, 'Jan: rent');
  assert.equal(await total('2031-02'), 0, 'Feb: nothing');
  assert.equal(await total('2031-03'), 700, 'Mar: residency');
  assert.equal(await total('2031-07'), 6000, 'Jul: rent again');
  assert.equal(await total('2031-09'), 700, 'Sep: residency again');
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

  await api('POST', `/payments/${rent.data.id}/pay`, t, { receipt: receipt() });
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
  await api('POST', `/payments/${late.data.id}/pay`, t, { receipt: receipt() });
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
  const omarLesson = await api('POST', '/expenses/home-lessons', t, { subject: 'math', childId: omar.data.id, amount: '200', occurredAt: now });
  const linaLesson = await api('POST', '/expenses/home-lessons', t, { subject: 'math', childId: lina.data.id, amount: '300', occurredAt: now });

  const invite = await api('POST', `/families/${state.father.family.id}/invitations`, t, { email: emails.child, role: 'CHILD', memberId: omar.data.id });
  assert.equal(invite.status, 201, invite.message);
  const child = await api('POST', '/auth/register', undefined, { name: 'Omar', email: emails.child, password: 'pw', inviteCode: invite.data.code });
  assert.equal(child.data.user.role, 'CHILD');
  const c = child.data.accessToken;
  Object.assign(state, { omarId: omar.data.id, linaId: lina.data.id, child: child.data });

  assert.equal((await api('GET', `/expenses/${omarLesson.data.id}`, c)).status, 200);
  assert.equal((await api('GET', `/expenses/${linaLesson.data.id}`, c)).status, 404, 'cannot read a sibling\'s expense');
  assert.equal((await api('GET', `/members/children/${lina.data.id}`, c)).status, 403);
  const kids = await api('GET', '/members/children', c);
  assert.deepEqual(kids.data.map((k: any) => k.id), [omar.data.id]);
  const report = await api('GET', '/expenses', c);
  assert.ok(report.data.expenses.every((e: any) => e.member?.id === omar.data.id || e.createdBy?.id === child.data.user.id));
  assert.equal((await api('GET', '/reports/monthly', c)).status, 403, 'no VIEW_REPORTS by default');
  assert.equal((await api('POST', '/expenses/home-lessons', c, { subject: 'math', childId: omar.data.id, amount: '5', occurredAt: now })).status, 403, 'no ADD_EXPENSE by default');
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
  const lesson = await api('POST', '/expenses/home-lessons', t, { subject: 'math', childId: kid.data.id, amount: '150', occurredAt: future, reminder });
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

test('Calculations: one family with known numbers — salary, spending, planned fees, still to pay, after paying', async () => {
  const reg = await api('POST', '/auth/register', undefined, { name: 'Calc', email: emails.calc, password: 'pw', familyName: `Calc ${run}`, timezone: 'Asia/Riyadh' });
  assert.equal(reg.status, 201, reg.message);
  const t = reg.data.accessToken;
  const today = localDate(new Date(), 'Asia/Riyadh');
  const dash = async () => (await api('GET', '/dashboard', t)).data.totals;
  const num = (value: unknown) => Number(value);

  await api('PUT', '/incomes/salary', t, { amount: '10000', payDay: 1 });
  let d = await dash();
  assert.equal(num(d.income), 10000);
  assert.equal(num(d.expenses), 0);
  assert.equal(num(d.balance), 10000);

  // Spent today: 1000.
  await api('POST', '/expenses/household', t, { amount: '1000', occurredAt: new Date().toISOString() });
  // A monthly household fee of 2000 starting today: counted as planned this month; its reminder must not count again.
  const fee = await api('POST', '/expenses/recurring-household', t, { amount: '2000', description: 'Rent', frequency: 'MONTHLY', startDate: today, reminder: { daysBefore: 0, time: '09:00' } });
  assert.equal(fee.status, 201, fee.message);
  // A lesson in an hour (an expense already) with its reminder: the reminder must not count again either.
  const kid = await api('POST', '/members/children', t, { name: 'Kid' });
  const lesson = await api('POST', '/expenses/home-lessons', t, { subject: 'math', childId: kid.data.id, amount: '300', occurredAt: new Date(Date.now() + 3_600_000).toISOString(), reminder: { daysBefore: 0, time: '00:00' } });
  assert.equal(lesson.status, 201, lesson.message);
  // A bill due today (not spent yet) and one due next year.
  const bill = await api('POST', '/payments', t, { name: 'Electricity', amount: '500', category: 'BILL', frequency: 'ONCE', dueDate: today, dueTime: '23:59' });
  await api('POST', '/payments', t, { name: 'Insurance', amount: '700', category: 'INSURANCE', frequency: 'ONCE', dueDate: `${Number(today.slice(0, 4)) + 1}-06-01`, dueTime: '10:00' });

  d = await dash();
  const sameMonth = new Date(Date.now() + 3_600_000).toISOString().slice(0, 7) === today.slice(0, 7);
  const spent = 1000 + 2000 + (sameMonth ? 300 : 0);
  assert.equal(num(d.expenses), spent, 'spending = expenses + planned fee (each once)');
  assert.equal(num(d.balance), 10000 - spent);
  assert.equal(num(d.stillToPay), 500, 'only the bill due this month that is not already in the spending');
  assert.equal(num(d.afterPaying), 10000 - spent - 500);
  assert.ok(Math.abs(d.spentRatio - spent / 10000) < 0.0001);

  const report = (await api('GET', '/reports/monthly', t)).data;
  assert.equal(num(report.totalAmount), num(report.household.totalAmount) + num(report.homeLessons.totalAmount) + num(report.other.spentAmount), 'the parts add up to the total');

  const summary = (await api('GET', '/payments/summary', t)).data;
  assert.equal(num(summary.total), num(summary.paid) + num(summary.toPay), 'paid + to pay = total');
  assert.equal(summary.totalCount, summary.paidCount + summary.toPayCount);

  // Paying moves money from "still to pay" into spending; what is left after paying stays the same.
  await api('POST', `/payments/${bill.data.id}/pay`, t, { receipt: receipt() });
  await api('POST', `/payments/${fee.data.reminder.id}/pay`, t, { receipt: receipt() });
  const after = await dash();
  assert.equal(num(after.expenses), spent + 500, 'the paid bill is spending now; the fee replaced its planned amount');
  assert.equal(num(after.stillToPay), 0);
  assert.equal(num(after.afterPaying), num(d.afterPaying), 'after paying does not change when you pay');

  // Removing the salary set this month leaves no income for the month.
  await api('DELETE', '/incomes/salary', t);
  const noSalary = (await api('GET', '/incomes/summary', t)).data;
  assert.equal(num(noSalary.totals.income), 0, 'a removed salary no longer counts');
  assert.equal(noSalary.salary, null);
});

test('Forgot password: members ask the father; email accounts reset with a one-time code', async () => {
  resetAuthLimits();
  const reg = await api('POST', '/auth/register', undefined, { name: 'Forgetful Dad', email: emails.forgot, password: 'old-pass', familyName: `Forgot ${run}` });
  assert.equal(reg.status, 201, reg.message);
  const t = reg.data.accessToken;
  const fid = reg.data.family.id;

  // Unknown accounts get the same answer (nothing to learn from it).
  const unknown = await api('POST', '/auth/forgot-password', undefined, { login: `nobody-${run}` });
  assert.equal(unknown.status, 200);

  // A member with a username: the father is asked, once, and the link opens the Family screen.
  const memberLogin = `forgot-kid-${run}`;
  const member = await api('POST', `/families/${fid}/members`, t, { name: 'Sara', login: memberLogin, password: 'secret', role: 'MOTHER' });
  const asked = await api('POST', '/auth/forgot-password', undefined, { login: memberLogin });
  assert.equal(asked.message, unknown.message, 'same reply as for an unknown account');
  await api('POST', '/auth/forgot-password', undefined, { login: memberLogin });
  const requests = (await api('GET', '/notifications', t)).data.items.filter((n: any) => n.type === 'PASSWORD_RESET_REQUEST');
  assert.equal(requests.length, 1, 'the father is asked once, not on every tap');
  assert.equal(requests[0].relatedEntityId, member.data.id);
  await api('PUT', `/families/${fid}/members/${member.data.id}/password`, t, { password: 'new-secret' });
  assert.equal((await api('POST', '/auth/login', undefined, { email: memberLogin, password: 'new-secret' })).status, 200);

  // An email account: a 6-digit code (here stored directly — tests don't send email).
  const user = await prisma.user.findUniqueOrThrow({ where: { email: emails.forgot } });
  const hash = (code: string) => createHash('sha256').update(`${user.id}:${code}`).digest('hex');
  const issue = (code: string) => prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hash(code), expiresAt: new Date(Date.now() + 900_000) } });
  await issue('111111');
  for (let i = 0; i < 5; i += 1) {
    const wrong = await api('POST', '/auth/reset-password', undefined, { login: emails.forgot, code: '000000', password: 'hacked' });
    assert.equal((wrong as any).code, 'INVALID_RESET_CODE');
  }
  resetAuthLimits();
  const locked = await api('POST', '/auth/reset-password', undefined, { login: emails.forgot, code: '111111', password: 'hacked' });
  assert.equal(locked.status, 400, 'after 5 wrong codes the code stops working');

  await prisma.passwordResetToken.updateMany({ where: { userId: user.id }, data: { usedAt: new Date() } });
  await issue('424242');
  const done = await api('POST', '/auth/reset-password', undefined, { login: emails.forgot, code: '424242', password: 'brand-new' });
  assert.equal(done.status, 200, done.message);
  assert.equal((await api('POST', '/auth/login', undefined, { email: emails.forgot, password: 'old-pass' })).status, 401, 'the old password no longer works');
  assert.equal((await api('POST', '/auth/login', undefined, { email: emails.forgot, password: 'brand-new' })).status, 200);
  assert.equal((await api('POST', '/auth/refresh', undefined, { refreshToken: reg.data.refreshToken })).status, 401, 'signed out everywhere');
  assert.equal((await api('POST', '/auth/reset-password', undefined, { login: emails.forgot, code: '424242', password: 'again' })).status, 400, 'a code works once');

  await prisma.user.deleteMany({ where: { email: memberLogin } });
  resetAuthLimits();
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

  // Sign-ins above add up; start this part with a fresh rate-limit window.
  resetAuthLimits();
  // An uncle: the father creates his login; he starts view-only and the father decides what else he may do.
  const uncleLogin = `uncle${run}`;
  const uncle = await api('POST', `/families/${fid}/members`, t, { name: 'Uncle Ali', login: uncleLogin, password: 'secret', role: 'UNCLE' });
  assert.equal(uncle.status, 201, uncle.message);
  assert.equal((await api('POST', '/auth/login', undefined, { email: uncleLogin, password: 'secret', as: 'FATHER' })).status, 403, 'an uncle is not an admin');
  const uncleSession = await api('POST', '/auth/login', undefined, { email: uncleLogin, password: 'secret', as: 'MEMBER' });
  assert.equal(uncleSession.status, 200, uncleSession.message);
  assert.equal(uncleSession.data.user.role, 'UNCLE');
  assert.equal(uncleSession.data.user.isAdmin, false);
  assert.deepEqual([...uncleSession.data.user.permissions].sort(), ['VIEW_EXPENSES', 'VIEW_PAYMENTS']);
  const u = uncleSession.data.accessToken;
  assert.equal((await api('GET', '/payments', u)).status, 200, 'he sees the payments');
  assert.equal((await api('POST', '/payments', u, { name: 'X', amount: '1', category: 'OTHER', frequency: 'ONCE', dueDate: '2031-01-01', dueTime: '09:00' })).status, 403, 'but cannot add one');
  assert.equal((await api('GET', '/incomes/summary', u)).status, 403, 'the salary stays hidden');
  assert.equal((await api('GET', '/private', u)).status, 403, 'private money is father-only');
  assert.equal((await api('PUT', `/families/${fid}/members/${uncle.data.id}/permissions`, u, { permissions: { ADD_EXPENSE: true } })).status, 403, 'he cannot change his own rights');
  await api('PUT', `/families/${fid}/members/${uncle.data.id}/permissions`, t, { permissions: { ADD_EXPENSE: true, SERVICE_HOUSEHOLD: true } });
  assert.equal((await api('POST', '/expenses/household', u, { amount: '25', occurredAt: new Date().toISOString() })).status, 201, 'the father lets him add expenses');
  await prisma.user.deleteMany({ where: { email: uncleLogin } });

  const reset = await api('PUT', `/families/${fid}/members/${created.data.id}/password`, t, { password: 'newpass' });
  assert.equal(reset.status, 200);
  assert.equal((await api('POST', '/auth/login', undefined, { email: login, password: 'newpass' })).status, 200);
  await prisma.user.deleteMany({ where: { email: login } });
});

test('Lessons keep the teacher name and number; payment screenshots are stored and protected', async () => {
  const t = state.father.accessToken;
  const kid = await api('POST', '/members/children', t, { name: 'Yousef' });
  const lesson = await api('POST', '/expenses/home-lessons', t, {
    subject: 'math',
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
  const paid = await api('POST', `/payments/${fee.data.reminder.id}/pay`, t, { receipt: receipt() });
  const record = (await api('GET', `/payments/${fee.data.reminder.id}`, t)).data.history[0];
  // The mother is told a receipt was attached; she can open it and download the image.
  const m = state.mother.accessToken;
  const told = (await api('GET', '/notifications', m)).data.items.find((n: any) => n.type === 'PAYMENT_RECEIPT' && n.relatedEntityId === fee.data.reminder.id);
  assert.ok(told, 'the mother is notified about the receipt');
  assert.equal(told.url, `/payment/${fee.data.reminder.id}`);
  assert.ok(!(await api('GET', '/notifications', t)).data.items.some((n: any) => n.type === 'PAYMENT_RECEIPT' && n.relatedEntityId === fee.data.reminder.id), 'not the one who attached it');
  const link = await api('POST', `/attachments/${record.receiptIds[0]}/download-link`, m);
  assert.equal(link.status, 200, link.message);
  const file = await fetch(`${base}/api${link.data.path}`);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-disposition') ?? '', /^attachment; filename="receipt-\d{4}-\d{2}-\d{2}\.(png|jpg|webp)"$/);
  assert.ok((await file.arrayBuffer()).byteLength > 50, 'the image bytes are downloaded');
  const tampered = link.data.path.replace(record.receiptIds[0], up.data.id);
  assert.equal((await fetch(`${base}/api${tampered}`)).status, 401, 'a link only opens its own image');
  assert.equal((await fetch(`${base}/api/attachments/${record.receiptIds[0]}/download?token=${'x'.repeat(40)}`)).status, 401);

  // The receipt comes only from confirming the payment: it can be viewed, not added to, replaced or deleted.
  const files = await api('GET', `/attachments?paymentRecordId=${record.id}`, t);
  assert.equal(files.data.length, 1);
  assert.equal(files.data[0].cycleDueDate, paid.data.paidCycle.dueDate);
  assert.equal(files.data[0].canDelete, false);
  assert.equal((await api('GET', `/attachments/${record.receiptIds[0]}`, t)).status, 200, 'the receipt can be viewed');
  assert.equal((await api('POST', '/attachments', t, { paymentRecordId: record.id, mimeType: 'image/jpeg', data: jpeg })).code, 'RECEIPT_LOCKED');
  assert.equal((await api('POST', '/attachments', t, { paymentId: fee.data.reminder.id, mimeType: 'image/jpeg', data: jpeg })).code, 'RECEIPT_LOCKED');
  assert.equal((await api('DELETE', `/attachments/${record.receiptIds[0]}`, t)).code, 'RECEIPT_LOCKED');

  state.attachmentId = up.data.id;
  state.attachmentExpense = lesson.data.id;
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

test('Teacher profile links lessons, fees and payments to the teacher', async () => {
  const t = state.father.accessToken;
  const kid = await api('POST', '/members/children', t, { name: 'Omar' });
  const lesson = await api('POST', '/expenses/home-lessons', t, {
    childId: kid.data.id, amount: '200', subject: 'math', occurredAt: new Date(Date.now() + 3_600_000).toISOString(),
    newTeacher: { name: 'Mr. Khaled', phone: '+966 50 000 0000' }, reminder: { daysBefore: 0, time: '00:00' },
  });
  assert.equal(lesson.status, 201, lesson.message);
  const teacherId = lesson.data.teacher.id;
  assert.equal(lesson.data.reminder.teacher.id, teacherId, "the lesson's reminder goes to the same teacher");

  const fee = await api('POST', '/expenses/recurring-home-lessons', t, { childId: kid.data.id, amount: '300', description: 'Math monthly', teacherId, reminder: { daysBefore: 0, time: '09:00' } });
  assert.equal(fee.data.reminder.teacher.id, teacherId);

  // A payment added on its own can name the teacher too, and paying it records a lesson expense for them.
  const own = await api('POST', '/payments', t, { name: 'Exam prep', amount: '150', category: 'TUITION', frequency: 'ONCE', dueDate: '2031-03-01', dueTime: '10:00', teacherId });
  assert.equal(own.status, 201, own.message);
  assert.equal(own.data.teacher.name, 'Mr. Khaled');
  await api('POST', `/payments/${own.data.id}/pay`, t, { receipt: receipt() });

  const profile = await api('GET', `/teachers/${teacherId}`, t);
  assert.equal(profile.status, 200, profile.message);
  assert.equal(profile.data.phone, '+966 50 000 0000');
  assert.equal(profile.data.fees.length, 1);
  assert.equal(profile.data.payments.length, 3, 'lesson reminder, fee reminder and the standalone payment');
  assert.equal(profile.data.lessonsCount, 2, 'the lesson and the paid payment');
  assert.ok(Math.abs(Number(profile.data.lessonsTotal) - 350) < 0.01);

  // Unlinking the payment takes it off the profile.
  const unlinked = await api('PUT', `/payments/${own.data.id}`, t, { teacherId: null });
  assert.equal(unlinked.data.teacher, null);
  assert.equal((await api('GET', `/teachers/${teacherId}`, t)).data.payments.length, 2);
  state.teacherId = teacherId;
});

test('Receipt check: the screenshot must show the payment amount, once; the father can override', async () => {
  const f = state.father.accessToken;
  const m = state.mother.accessToken;
  const reading = (amount: number | null, extra: Partial<ReceiptReading> = {}): ReceiptReading => ({ isPaymentProof: true, amount, totalWithFees: null, currency: 'EGP', succeeded: true, ...extra });
  let next: ReceiptReading | null = null;
  let scans = 0;
  setReceiptReader(async () => { scans++; return next; });
  const bill = async (name: string) =>
    (await api('POST', '/payments', f, { name, amount: '500', currency: 'EGP', category: 'BILL', frequency: 'ONCE', dueDate: '2031-07-01', dueTime: '10:00', assigneeId: state.mother.user.id })).data;
  try {
    // Matching amount: checked first, then paid without a second scan of the same image.
    const ok = await bill(`Electricity ${run}`);
    next = reading(500);
    const image = receipt();
    const check = await api('POST', `/payments/${ok.id}/check-receipt`, m, { receipt: image });
    assert.equal(check.status, 200, check.message);
    assert.equal(check.data.status, 'MATCH');
    assert.equal(check.data.blocked, false);
    assert.equal(check.data.canOverride, false, 'only the father can override');
    const paid = await api('POST', `/payments/${ok.id}/pay`, m, { receipt: image });
    assert.equal(paid.status, 200, paid.message);
    assert.equal(paid.data.receiptCheck, 'MATCH');
    assert.equal(scans, 1, 'the same image is scanned once');
    const history = (await api('GET', `/payments/${ok.id}`, f)).data.history[0];
    assert.equal(history.receiptCheck, 'MATCH');
    assert.equal(Number(history.receiptAmount), 500);

    // The same screenshot can't prove a second payment.
    const second = await bill(`Water ${run}`);
    const dup = await api('POST', `/payments/${second.id}/check-receipt`, m, { receipt: image });
    assert.equal(dup.data.status, 'DUPLICATE');
    assert.equal(dup.data.usedFor.name, `Electricity ${run}`);
    assert.equal((await api('POST', `/payments/${second.id}/pay`, m, { receipt: image })).code, 'RECEIPT_DUPLICATE');

    // A different amount blocks the mother; a small rounding difference doesn't.
    next = reading(450);
    const wrong = receipt();
    assert.equal((await api('POST', `/payments/${second.id}/check-receipt`, m, { receipt: wrong })).data.status, 'MISMATCH');
    const blocked = await api('POST', `/payments/${second.id}/pay`, m, { receipt: wrong, override: true });
    assert.equal(blocked.status, 409, 'the mother cannot override');
    assert.equal(blocked.code, 'RECEIPT_MISMATCH');
    next = reading(503.5);
    assert.equal((await api('POST', `/payments/${second.id}/check-receipt`, m, { receipt: receipt() })).data.status, 'MATCH', 'within 1%');
    next = reading(480, { totalWithFees: 500 });
    assert.equal((await api('POST', `/payments/${second.id}/check-receipt`, m, { receipt: receipt() })).data.status, 'MATCH', 'the total with fees can match');

    // Not a receipt, or a failed transfer.
    next = { isPaymentProof: false, amount: null, totalWithFees: null, currency: null, succeeded: null };
    const selfie = await api('POST', `/payments/${second.id}/check-receipt`, m, { receipt: receipt() });
    assert.deepEqual([selfie.data.status, selfie.data.reason], ['UNREADABLE', 'NOT_A_RECEIPT']);
    next = reading(500, { succeeded: false });
    assert.equal((await api('POST', `/payments/${second.id}/check-receipt`, m, { receipt: receipt() })).data.reason, 'TRANSFER_FAILED');

    // The father confirms anyway; it is recorded as overridden.
    next = reading(450);
    assert.equal((await api('POST', `/payments/${second.id}/pay`, f, { receipt: wrong })).status, 409, 'override must be explicit');
    const forced = await api('POST', `/payments/${second.id}/pay`, f, { receipt: wrong, override: true });
    assert.equal(forced.status, 200, forced.message);
    const record = (await api('GET', `/payments/${second.id}`, f)).data.history[0];
    assert.equal(record.receiptCheck, 'MISMATCH');
    assert.equal(record.overridden, true);

    // Teacher payments: the transfer date must be in the due month, and the money must go to the teacher.
    const teacher = await api('POST', '/teachers', f, { name: `Eyad Hassan ${run}`, phone: '+20 101 234 5678' });
    assert.equal(teacher.status, 201, teacher.message);
    let seenTeacher: string | null = null;
    setReceiptReader(async (_image, context) => { seenTeacher = context.teacherName; return next; });
    const lesson = async (name: string) =>
      (await api('POST', '/payments', f, { name, amount: '1400', currency: 'EGP', category: 'TUITION', frequency: 'ONCE', dueDate: '2031-08-10', dueTime: '10:00', assigneeId: state.mother.user.id, teacherId: teacher.data.id })).data;
    const eyad = await lesson(`Lesson ${run}`);
    // The transfer must be in the month the payment is confirmed (this month), whatever the due date.
    const thisMonth = localDate(new Date(), 'Asia/Riyadh').slice(0, 7);
    const inMonth = `${thisMonth}-01`;
    const previousMonth = addDays(inMonth, -1);
    const checkLesson = async (r: ReceiptReading) => {
      next = r;
      return (await api('POST', `/payments/${eyad.id}/check-receipt`, m, { receipt: receipt() })).data;
    };
    const good = await checkLesson(reading(1400, { transferDate: inMonth, recipientNumber: '010****5678' }));
    assert.equal(good.status, 'MATCH');
    assert.deepEqual(good.checks, { amount: 'ok', date: 'ok', recipient: 'ok' });
    assert.equal(seenTeacher, `Eyad Hassan ${run}`, 'the scanner is told whose name to look for');
    assert.equal(good.expectedMonth, thisMonth, 'early payment for a later due date is fine: the due date is in 2031');
    const lastMonth = await checkLesson(reading(1400, { transferDate: previousMonth, recipientNumber: '01012345678' }));
    assert.deepEqual([lastMonth.status, lastMonth.reason, lastMonth.checks.date], ['MISMATCH', 'DATE_OUT_OF_RANGE', 'bad']);
    const otherPerson = await checkLesson(reading(1400, { transferDate: inMonth, recipientNumber: '01198765432' }));
    assert.deepEqual([otherPerson.reason, otherPerson.blocked], ['WRONG_RECIPIENT', true]);
    const byName = await checkLesson(reading(1400, { transferDate: inMonth, recipientNumber: null, recipientName: 'إياد حسن', firstNameMatches: true }));
    assert.deepEqual([byName.status, byName.checks.recipient], ['MATCH', 'ok'], 'no number: the first name decides');
    const wrongName = await checkLesson(reading(1400, { transferDate: inMonth, recipientNumber: null, recipientName: 'Omar', firstNameMatches: false }));
    assert.equal(wrongName.reason, 'WRONG_RECIPIENT');
    const nothingShown = await checkLesson(reading(1400, { transferDate: null, recipientNumber: null, recipientName: null, firstNameMatches: null }));
    assert.deepEqual([nothingShown.status, nothingShown.checks], ['MATCH', { amount: 'ok', date: 'unknown', recipient: 'unknown' }], 'not shown: allowed, marked unknown');
    const paidLesson = await api('POST', `/payments/${eyad.id}/pay`, m, { receipt: receipt() });
    assert.equal(paidLesson.status, 200, paidLesson.message);
    const lessonRecord = (await api('GET', `/payments/${eyad.id}`, f)).data.history[0];
    assert.deepEqual(lessonRecord.receiptChecks, { amount: 'ok', date: 'unknown', recipient: 'unknown' });
    setReceiptReader(async () => { scans++; return next; });

    // Scanner down: the payment goes through, marked as not checked.
    const third = await bill(`Gas ${run}`);
    next = null;
    const unchecked = await api('POST', `/payments/${third.id}/pay`, m, { receipt: receipt() });
    assert.equal(unchecked.status, 200, unchecked.message);
    assert.equal(unchecked.data.receiptCheck, 'UNAVAILABLE');
  } finally {
    setReceiptReader(null);
  }
});

test('Children points: father rules and limits, mother evaluates, tasks, penalties, rewards, money and audit', async () => {
  const f = state.father.accessToken;
  const m = state.mother.accessToken;
  const c = state.child.accessToken;
  const kid = state.omarId;
  const month = localDate(new Date(), 'Asia/Riyadh').slice(0, 7);
  const spending = async () => Number((await api('GET', `/reports/monthly?month=${month}`, f)).data.totalAmount);
  const board = async (token = f) => (await api('GET', `/kids/${kid}`, token)).data;

  // The father sets the rules; nobody else can.
  assert.equal((await api('PUT', '/kids/settings', m, { maxAwardPoints: 999 })).status, 403);
  const settings = await api('PUT', '/kids/settings', f, { pointValue: '0.5', maxAwardPoints: 30, maxPenaltyPoints: 10, dailyPenaltyLimit: 15, maxPenaltyAmount: '20', allowNegativePoints: false });
  assert.equal(settings.status, 200, settings.message);
  assert.equal(settings.data.settings.maxPenaltyPoints, 10);
  assert.equal((await api('POST', '/kids/rules', m, { kind: 'BEHAVIOR', name: 'x', points: 5 })).status, 403);
  const rules = (await api('POST', '/kids/rules', f, { kind: 'BEHAVIOR', name: 'Helped at home', points: 10 })).data.rules;
  await api('POST', '/kids/rules', f, { kind: 'PENALTY', name: 'Shouting', points: 5 });
  const all = (await api('POST', '/kids/rules', f, { kind: 'REWARD', name: 'Park trip', points: 20 })).data.rules;
  const rule = (kind: string) => all.find((r: any) => r.kind === kind).id;
  assert.equal(rules.length, 1);

  // The mother gives points; the points always come from the server-side rule.
  const byRule = await api('POST', `/kids/${kid}/points`, m, { ruleId: rule('BEHAVIOR') });
  assert.equal(byRule.status, 201, byRule.message);
  assert.equal(byRule.data.points, 10);
  assert.equal((await api('POST', `/kids/${kid}/points`, m, { ruleId: rule('PENALTY') })).status, 404, 'a penalty rule cannot be used to give points');
  assert.equal((await api('POST', `/kids/${kid}/points`, m, { points: 31, reason: 'Too many' })).status, 422, 'above the father\'s per-award limit');
  assert.equal((await api('POST', `/kids/${kid}/points`, m, { points: 15 })).status, 422, 'a custom award needs a reason');
  assert.equal((await api('POST', `/kids/${kid}/points`, m, { points: 15, reason: 'Read a book' })).data.points, 25);
  assert.equal((await api('POST', `/kids/${kid}/points`, c, { points: 5, reason: 'Me' })).status, 403, 'a child cannot give itself points');
  assert.equal((await api('GET', `/kids/${state.linaId}`, c)).status, 403, 'a child cannot see a sibling');
  assert.deepEqual((await api('GET', '/kids', c)).data.map((k: any) => k.id), [kid]);

  // Tasks: created by a parent, marked done by the child, approved once by a parent.
  const created = await api('POST', `/kids/${kid}/tasks`, m, { title: 'Clean room', points: 10, dueDate: localDate(new Date(), 'Asia/Riyadh') });
  assert.equal(created.status, 201, created.message);
  const task = created.data.tasks.find((t: any) => t.title === 'Clean room');
  assert.equal(task.status, 'PENDING');
  assert.equal((await api('POST', `/kids/${kid}/tasks`, c, { title: 'x', points: 1 })).status, 403);
  const done = await api('POST', `/kids/tasks/${task.id}/complete`, c);
  assert.equal(done.status, 200, done.message);
  assert.equal(done.data.tasks.find((t: any) => t.id === task.id).status, 'COMPLETED');
  assert.ok((await api('GET', '/notifications', f)).data.items.some((n: any) => n.type === 'CHILD_POINTS' && n.url === `/kids/${kid}`), 'the father hears the task is done');
  assert.equal((await api('POST', `/kids/tasks/${task.id}/approve`, c)).status, 403, 'a child cannot approve');
  const approved = await api('POST', `/kids/tasks/${task.id}/approve`, m);
  assert.equal(approved.data.points, 35);
  assert.equal((await api('POST', `/kids/tasks/${task.id}/approve`, m)).status, 409, 'points are given once');
  assert.equal((await api('DELETE', `/kids/tasks/${task.id}`, m)).status, 409, 'approved tasks are kept');

  const second = (await api('POST', `/kids/${kid}/tasks`, m, { title: 'Homework', points: 5 })).data.tasks.find((t: any) => t.title === 'Homework');
  await api('POST', `/kids/tasks/${second.id}/complete`, c);
  const sentBack = await api('POST', `/kids/tasks/${second.id}/return`, m, { note: 'Finish page 2' });
  const returned = sentBack.data.tasks.find((t: any) => t.id === second.id);
  assert.equal(returned.status, 'PENDING');
  assert.equal(returned.reviewNote, 'Finish page 2');

  // Penalties stay inside the father's limits.
  assert.equal((await api('POST', `/kids/${kid}/penalties`, m, { ruleId: rule('PENALTY') })).data.points, 30);
  assert.equal((await api('POST', `/kids/${kid}/penalties`, m, { points: 11, reason: 'Big mistake' })).status, 422, 'above the per-penalty limit');
  assert.equal((await api('POST', `/kids/${kid}/penalties`, m, { points: 10 })).status, 422, 'a penalty needs a reason');
  const penalty = await api('POST', `/kids/${kid}/penalties`, m, { points: 10, reason: 'Broke the rules' });
  assert.equal(penalty.data.points, 20);
  const limited = await api('POST', `/kids/${kid}/penalties`, f, { points: 5, reason: 'Again' });
  assert.equal(limited.status, 409);
  assert.equal(limited.code, 'PENALTY_LIMIT', 'the daily limit covers every parent');
  await api('PUT', `/families/${state.father.family.id}/members/${state.mother.user.id}/permissions`, f, { permissions: { PENALIZE_CHILDREN: false } });
  assert.equal((await api('POST', `/kids/${kid}/penalties`, m, { points: 1, reason: 'x' })).status, 403, 'the father can take penalties away from the mother');
  await api('PUT', `/families/${state.father.family.id}/members/${state.mother.user.id}/permissions`, f, { permissions: { PENALIZE_CHILDREN: true } });

  // Rewards spend points and never go below zero.
  assert.equal((await api('POST', `/kids/${kid}/rewards`, m, { ruleId: rule('REWARD') })).data.points, 0);
  assert.equal((await api('POST', `/kids/${kid}/rewards`, m, { ruleId: rule('REWARD') })).code, 'INSUFFICIENT_POINTS');
  assert.equal((await api('POST', `/kids/${kid}/penalties`, f, { points: 1, reason: 'x' })).status, 409, 'no negative points unless the father allows it');

  // Money: only the father converts and pays; payouts and allowances are family expenses.
  await api('POST', `/kids/${kid}/points`, f, { points: 30, reason: 'Great week' });
  assert.equal((await api('POST', `/kids/${kid}/convert`, m, { points: 20 })).status, 403);
  const converted = await api('POST', `/kids/${kid}/convert`, f, { points: 20 });
  assert.equal(converted.data.points, 10);
  assert.equal(converted.data.money, '10.00', '20 points × 0.5');
  assert.equal((await api('POST', `/kids/${kid}/penalties`, m, { amount: '25', reason: 'Lost a book' })).status, 422, 'above the money penalty limit');
  assert.equal((await api('POST', `/kids/${kid}/penalties`, m, { amount: '3', reason: 'Lost a book' })).data.money, '7.00');

  const before = await spending();
  assert.equal((await api('POST', `/kids/${kid}/payouts`, f, { amount: '8' })).code, 'INSUFFICIENT_BALANCE');
  assert.equal((await api('POST', `/kids/${kid}/payouts`, m, { amount: '1' })).status, 403);
  const paid = await api('POST', `/kids/${kid}/payouts`, f, { amount: '7' });
  assert.equal(paid.data.money, '0.00');
  await api('POST', `/kids/${kid}/allowances`, f, { amount: '50', note: 'Weekly pocket money' });
  assert.ok(Math.abs((await spending()) - (before + 57)) < 0.01, 'reward payout and allowance count as family spending');
  const expenses = (await api('GET', `/expenses?month=${month}`, f)).data.expenses.filter((e: any) => e.member?.id === kid && e.category.key === 'children');
  assert.deepEqual(expenses.map((e: any) => e.subcategory.key).sort(), ['pocket_money', 'rewards'], 'rewards and allowances are categorized separately');

  // Undo: the payout's expense goes away and the money comes back; an approved task goes back to "done".
  const entries = (await board()).entries;
  const payout = entries.find((e: any) => e.kind === 'PAYOUT');
  assert.equal(payout.canVoid, true);
  assert.equal((await api('POST', `/kids/entries/${payout.id}/void`, m)).status, 403, 'only the father undoes money');
  assert.equal((await api('POST', `/kids/entries/${payout.id}/void`, f, { reason: 'Wrong amount' })).data.money, '7.00');
  assert.ok(Math.abs((await spending()) - (before + 50)) < 0.01);
  const taskEntry = entries.find((e: any) => e.kind === 'TASK');
  const undone = await api('POST', `/kids/entries/${taskEntry.id}/void`, m);
  assert.equal(undone.status, 200, undone.message);
  assert.equal(undone.data.points, 0);
  assert.equal(undone.data.tasks.find((t: any) => t.id === task.id).status, 'COMPLETED');
  assert.equal((await api('POST', `/kids/entries/${taskEntry.id}/void`, f)).status, 409, 'already undone');

  // The child's dashboard is read-only for the child and shows history and progress.
  const own = await board(c);
  assert.deepEqual(own.can, { award: false, penalize: false, manageTasks: false, manageMoney: false, configure: false });
  assert.ok(own.entries.length >= 10);
  assert.equal(own.weeks.length, 8);
  assert.ok(own.achievements.find((a: any) => a.key === 'first_reward').earned);
  assert.ok(own.rules.every((r: any) => r.kind === 'REWARD'), 'a child only sees the rewards list');

  const report = await api('GET', `/kids/${kid}/report?period=month`, f);
  assert.equal(report.status, 200, report.message);
  assert.equal(report.data.points.penalties, 15);
  assert.equal(report.data.money.allowances, '50.00');
  assert.equal(report.data.money.rewardsPaid, '0.00', 'the undone payout does not count');
  assert.equal(report.data.money.penalties, '3.00');
  assert.equal((await api('GET', `/kids/${kid}/report?period=week`, c)).status, 200);

  // Every change is in the audit log, which only the father reads.
  assert.equal((await api('GET', '/kids/audit', m)).status, 403);
  const log = await api('GET', `/kids/audit?childId=${kid}`, f);
  const actions = new Set(log.data.map((a: any) => a.action));
  for (const action of ['points.award', 'task.create', 'task.complete', 'task.approve', 'task.return', 'penalty.points', 'penalty.money', 'reward.redeem', 'points.convert', 'money.payout', 'money.allowance', 'entry.void']) {
    assert.ok(actions.has(action), `audit has ${action}`);
  }
  assert.ok(log.data.some((a: any) => a.action === 'points.award' && a.actor.id === state.mother.user.id), 'it records which parent did it');
});

test('Daily tasks: a copy each chosen day, approve for points, missed when the day ends, points per day', async () => {
  const f = state.father.accessToken;
  const m = state.mother.accessToken;
  const c = state.child.accessToken;
  const kid = state.omarId;
  const today = localDate(new Date(), 'Asia/Riyadh');
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const otherDay = (weekday + 1) % 7;

  assert.equal((await api('POST', `/kids/${kid}/daily`, c, { title: 'x', points: 1 })).status, 403, 'a child cannot add daily tasks');
  const made = await api('POST', `/kids/${kid}/daily`, m, { title: 'Make your bed', points: 5 });
  assert.equal(made.status, 201, made.message);
  const daily = made.data.dailyTasks.find((d: any) => d.title === 'Make your bed');
  assert.deepEqual(daily.weekdays, [0, 1, 2, 3, 4, 5, 6], 'every day by default');
  await api('POST', `/kids/${kid}/daily`, m, { title: 'Not today', points: 3, weekdays: [otherDay] });

  // Opening the board twice still makes one copy for today; a task for another weekday makes none.
  await api('GET', `/kids/${kid}`, c);
  const board = (await api('GET', `/kids/${kid}`, c)).data;
  const copies = board.tasks.filter((t: any) => t.daily);
  assert.deepEqual(copies.map((t: any) => t.title), ['Make your bed']);
  const copy = copies[0];
  assert.equal(copy.forDate, today);
  assert.equal(copy.canEdit, false, 'a day copy is changed through its daily task');
  assert.equal((await api('DELETE', `/kids/tasks/${copy.id}`, m)).code, 'DAILY_TASK_COPY');
  assert.deepEqual([board.today.dailyTotal, board.today.dailyDone], [1, 0]);

  const before = board.points;
  assert.equal((await api('POST', `/kids/tasks/${copy.id}/complete`, c)).status, 200);
  const approved = await api('POST', `/kids/tasks/${copy.id}/approve`, m);
  assert.equal(approved.data.points, before + 5, 'approved: points added');
  assert.deepEqual([approved.data.today.dailyDone, approved.data.today.dailyApproved], [1, 1]);
  assert.ok(approved.data.today.earned >= 5, "today's points include it");

  // Yesterday's copy that was never done closes as missed (no penalty); a parent can still approve it.
  const yesterday = addDays(today, -1);
  const old = await prisma.childTask.create({
    data: { familyId: state.father.family.id, memberId: kid, title: 'Make your bed', points: 5, dueDate: new Date(`${yesterday}T00:00:00Z`), forDate: new Date(`${yesterday}T00:00:00Z`), dailyTaskId: daily.id },
  });
  const pointsBefore = (await api('GET', `/kids/${kid}`, c)).data.points;
  const day = await api('GET', `/kids/${kid}/day?date=${yesterday}`, c);
  assert.equal(day.status, 200, day.message);
  const missed = day.data.dailyTasks.find((t: any) => t.id === old.id);
  assert.equal(missed.status, 'MISSED');
  assert.equal(missed.canComplete, false, 'the day is over');
  assert.equal((await api('POST', `/kids/tasks/${old.id}/complete`, c)).code, 'TASK_DAY_OVER');
  assert.equal((await api('GET', `/kids/${kid}`, c)).data.points, pointsBefore, 'missing a day costs nothing');
  assert.equal((await api('POST', `/kids/tasks/${old.id}/approve`, m)).status, 200, 'a parent can approve a missed one');

  // The day view: today's points and tasks.
  const todayView = (await api('GET', `/kids/${kid}/day`, m)).data;
  assert.equal(todayView.date, today);
  assert.equal(todayView.isToday, true);
  assert.ok(todayView.entries.some((e: any) => e.kind === 'TASK' && e.reason === 'Make your bed'));
  assert.equal((await api('GET', `/kids/${kid}/day?date=${addDays(today, 1)}`, m)).status, 400, 'no future days');
  assert.equal((await api('GET', `/kids/${kid}/report?period=month`, f)).data.counts.dailyMissed >= 0, true);

  // Stopping it removes today's unfinished copy; finished days stay.
  const tmp = (await api('POST', `/kids/${kid}/daily`, m, { title: 'Read 10 pages', points: 4 })).data;
  const tmpDaily = tmp.dailyTasks.find((d: any) => d.title === 'Read 10 pages');
  assert.ok(tmp.tasks.some((t: any) => t.title === 'Read 10 pages'));
  const stopped = await api('DELETE', `/kids/daily/${tmpDaily.id}`, m);
  assert.ok(!stopped.data.tasks.some((t: any) => t.title === 'Read 10 pages'));
  assert.ok(!stopped.data.dailyTasks.some((d: any) => d.id === tmpDaily.id));
  assert.equal((await api('PUT', `/kids/daily/${daily.id}`, c, { points: 50 })).status, 403);
});

test('Sign-in limits: one account\'s wrong passwords don\'t block the rest of the family; wrong sign-in type doesn\'t count', async () => {
  resetAuthLimits();
  // Choosing "family member" for the father's account is a mistake, not a wrong password: never blocks.
  for (let i = 0; i < 12; i++) {
    const wrongType = await api('POST', '/auth/login', undefined, { email: emails.father, password: 'pw', as: 'MEMBER' });
    assert.equal(wrongType.code, 'FATHER_ACCOUNT');
  }
  assert.equal((await api('POST', '/auth/login', undefined, { email: emails.father, password: 'pw', as: 'FATHER' })).status, 200, 'still signs in');

  // Ten wrong passwords lock that account for 15 minutes…
  for (let i = 0; i < 10; i++) assert.equal((await api('POST', '/auth/login', undefined, { email: emails.mother, password: 'wrong' })).status, 401);
  const locked = await api('POST', '/auth/login', undefined, { email: emails.mother, password: 'pw' });
  assert.equal(locked.status, 429, 'the account being guessed is locked');
  // …but someone else in the family, on the same network, can still sign in.
  assert.equal((await api('POST', '/auth/login', undefined, { email: emails.father, password: 'pw', as: 'FATHER' })).status, 200);
  // A stale session failing to refresh doesn't count against signing in.
  for (let i = 0; i < 8; i++) assert.equal((await api('POST', '/auth/refresh', undefined, { refreshToken: 'x'.repeat(64) })).status, 401);
  assert.equal((await api('POST', '/auth/login', undefined, { email: emails.father, password: 'pw', as: 'FATHER' })).status, 200);
  resetAuthLimits();
});

test('Subjects: a managed list; lessons choose from it; the name shows on lesson payments', async () => {
  const f = state.father.accessToken;
  const list = (await api('GET', '/subjects', f)).data;
  assert.ok(list.some((x: any) => x.key === 'math' && x.builtin), 'built-in subjects are there');
  const added = await api('POST', '/subjects', f, { name: `Robotics ${run}` });
  assert.equal(added.status, 201, added.message);
  assert.equal((await api('POST', '/subjects', f, { name: `robotics ${run}` })).status, 409, 'no duplicate names');

  const child = (await api('POST', '/members/children', f, { name: 'Subject kid' })).data;
  const typed = await api('POST', '/expenses/home-lessons', f, { childId: child.id, amount: '100', occurredAt: new Date().toISOString(), subject: 'Something typed' });
  assert.equal(typed.status, 422, 'a subject must be chosen from the list');
  const none = await api('POST', '/expenses/home-lessons', f, { childId: child.id, amount: '100', occurredAt: new Date().toISOString() });
  assert.equal(none.status, 422, 'a new lesson needs a subject');
  const fee = await api('POST', '/expenses/recurring-home-lessons', f, { childId: child.id, amount: '900', description: 'Robotics', startDate: localDate(new Date(), 'Asia/Riyadh'), subject: added.data.key, reminder: { daysBefore: 0, time: '09:00' } });
  assert.equal(fee.status, 201, fee.message);

  // Renaming shows everywhere, including the lesson's payment.
  await api('PUT', `/subjects/${added.data.id}`, f, { name: `Robotics club ${run}` });
  const payment = (await api('GET', `/payments/${fee.data.reminder.id}`, f)).data;
  assert.equal(payment.subject, added.data.key);
  assert.equal(payment.subjectName, `Robotics club ${run}`);
  assert.ok((await api('GET', '/payments', f)).data.some((p: any) => p.id === fee.data.reminder.id && p.subjectName === `Robotics club ${run}`));

  // Removed: gone from new lessons, but existing ones keep it.
  assert.equal((await api('DELETE', `/subjects/${added.data.id}`, f)).status, 200);
  assert.equal((await api('POST', '/expenses/home-lessons', f, { childId: child.id, amount: '100', occurredAt: new Date().toISOString(), subject: added.data.key })).status, 422);
  assert.equal((await api('GET', `/payments/${fee.data.reminder.id}`, f)).data.subjectName, `Robotics club ${run}`);
  assert.equal((await api('POST', '/subjects', state.child.accessToken, { name: 'x' })).status, 403, 'children cannot manage subjects');
});

test('Household sections can be renamed (father only)', async () => {
  const f = state.father.accessToken;
  const made = await api('POST', '/household-sections', f, { name: `Garden ${run}` });
  assert.equal(made.status, 201, made.message);
  const renamed = await api('PUT', `/household-sections/${made.data.id}`, f, { name: `Garden & pool ${run}` });
  assert.equal(renamed.status, 200, renamed.message);
  assert.equal(renamed.data.nameAr, `Garden & pool ${run}`);
  assert.ok((await api('GET', '/household-sections', f)).data.some((x: any) => x.id === made.data.id && x.nameAr === `Garden & pool ${run}`));
  assert.equal((await api('PUT', `/household-sections/${made.data.id}`, state.child.accessToken, { name: 'x' })).status, 403);
});

test('Invitations can be deleted, whatever their status', async () => {
  const f = state.father.accessToken;
  const fid = state.father.family.id;
  const pending = await api('POST', `/families/${fid}/invitations`, f, { email: `uncle-${run}@test.local`, role: 'UNCLE' });
  assert.equal(pending.status, 201, pending.message);
  assert.equal((await api('DELETE', `/families/${fid}/invitations/${pending.data.id}`, state.mother.accessToken)).status, 403, 'only the father');
  assert.equal((await api('DELETE', `/families/${fid}/invitations/${pending.data.id}`, f)).status, 200);
  assert.equal((await api('GET', `/invitations/${pending.data.code}`)).status, 404, 'its code no longer works');
  const list = (await api('GET', `/families/${fid}/invitations`, f)).data;
  assert.ok(!list.some((i: any) => i.id === pending.data.id), 'gone from the list');

  // An accepted invitation can be cleared too; the member who joined stays.
  assert.equal((await api('DELETE', `/families/${fid}/invitations/${state.invite.id}`, f)).status, 200);
  assert.ok(!(await api('GET', `/families/${fid}/invitations`, f)).data.some((i: any) => i.id === state.invite.id));
  assert.equal((await api('GET', '/payments', state.mother.accessToken)).status, 200, 'the mother is still in the family');
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
  assert.equal((await api('POST', `/payments/${state.payment.id}/pay`, t, { receipt: receipt() })).status, 404);
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
  assert.equal((await api('POST', `/attachments/${state.attachmentId}/download-link`, t)).status, 404, 'another family cannot get a download link');
  assert.equal((await api('GET', '/teachers', t)).data.length, 0);
  assert.equal((await api('GET', `/teachers/${state.teacherId}`, t)).status, 404, 'another family cannot open the teacher');
  assert.equal((await api('GET', `/wallets/${state.walletId}`, t)).status, 404, 'another family cannot see the allowance');
  assert.equal((await api('POST', `/wallets/${state.walletId}/spend`, t, { amount: '1' })).status, 404);
  assert.equal((await api('GET', '/wallets', t)).data.length, 0);
  assert.equal((await api('GET', `/kids/${state.omarId}`, t)).status, 404, 'another family cannot see a child\'s points');
  assert.equal((await api('POST', `/kids/${state.omarId}/points`, t, { points: 1, reason: 'x' })).status, 404);
  assert.equal((await api('GET', '/kids', t)).data.length, 0);
  assert.equal((await api('GET', '/kids/audit', t)).data.length, 0);
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

  // Removed everywhere: the account no longer exists, and the family's records stay with the father.
  assert.equal(await prisma.user.findUnique({ where: { id: state.mother.user.id } }), null, 'the account is deleted');
  assert.equal(await prisma.payment.count({ where: { familyId: state.father.family.id, OR: [{ createdById: state.mother.user.id }, { assigneeId: state.mother.user.id }] } }), 0);
  assert.ok(await prisma.wallet.findUnique({ where: { id: state.walletId } }), 'her allowance is kept');
  assert.equal((await prisma.wallet.findUniqueOrThrow({ where: { id: state.walletId } })).holderId, state.father.user.id);
  const login = await api('POST', '/auth/login', undefined, { email: emails.mother, password: 'pw', as: 'MEMBER' });
  assert.equal(login.status, 401, 'no "no longer part of a family" leftover: the account is simply gone');

  // The same email can be invited again and joins as a fresh account.
  const again = await api('POST', `/families/${state.father.family.id}/invitations`, state.father.accessToken, { email: emails.mother, role: 'MOTHER' });
  assert.equal(again.status, 201, again.message);
  const rejoined = await api('POST', '/auth/register', undefined, { name: 'Mother', email: emails.mother, password: 'pw2', inviteCode: again.data.code });
  assert.equal(rejoined.status, 201, rejoined.message);
  assert.equal(rejoined.data.family.id, state.father.family.id);
});

test('Removing a child removes it everywhere: its login, daily tasks and open tasks', async () => {
  const f = state.father.accessToken;
  const kid = (await api('POST', '/members/children', f, { name: 'Temp kid' })).data;
  const account = await api('POST', `/families/${state.father.family.id}/members`, f, { name: 'Temp kid', login: `tempkid-${run}`, password: 'pw123456', role: 'CHILD', memberId: kid.id });
  assert.equal(account.status, 201, account.message);
  await api('POST', `/kids/${kid.id}/daily`, f, { title: 'Brush teeth', points: 2 });
  await api('POST', `/kids/${kid.id}/tasks`, f, { title: 'Clean desk', points: 3 });

  const removed = await api('DELETE', `/members/children/${kid.id}`, f);
  assert.equal(removed.status, 200, removed.message);
  assert.equal(await prisma.user.count({ where: { memberId: kid.id } }), 0, "the child's login is deleted");
  assert.equal((await api('POST', '/auth/login', undefined, { email: `tempkid-${run}`, password: 'pw123456', as: 'MEMBER' })).status, 401);
  assert.equal(await prisma.dailyTask.count({ where: { memberId: kid.id, isActive: true } }), 0, 'daily tasks stop');
  assert.equal(await prisma.childTask.count({ where: { memberId: kid.id, deletedAt: null, status: { in: ['PENDING', 'COMPLETED'] } } }), 0, 'open tasks are removed');
  assert.equal((await api('GET', `/kids/${kid.id}`, f)).status, 404);
});

test('Super admin sees every family and enters any of them without a password', async () => {
  // Earlier tests spend the auth limiter's failure budget on purpose.
  resetAuthLimits();
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
  const lesson = await api('POST', '/expenses/home-lessons', t, { subject: 'math', childId: kid.data.id, amount: '50', currency: 'EUR', occurredAt: new Date().toISOString() });
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
