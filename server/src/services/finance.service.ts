import type { Currency, Expense, Family, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { Decimal, toMoneyString } from '../utils/money';
import { formatDateOnly, monthRange, parseDateOnly, todayInTimeZone } from '../utils/dates';
import { AppError } from '../utils/AppError';
import { randomUUID } from 'node:crypto';
import type { ChildInput, SectionInput, HouseholdExpenseInput, LessonExpenseInput, RecurringLessonInput, ExpenseUpdateInput, RecurringHouseholdInput, ReminderOption } from '../validators/finance.validator';
import type { PaymentCategory, PaymentFrequency } from '@prisma/client';
import { cancelLinkedPayments, createPayment, firstDueOnOrAfter } from './payment.service';
import { localDate } from '../utils/time';
import { convertAmount } from './rates.service';
import { resolveTeacher, teacherSelect } from './teacher.service';
import { assertAdmin, assertCan, assertOwnChild, can, childScope, expenseScope, recurringScope, type Actor } from './access.service';

function monthInTimeZone(timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(new Date());
}

function toLocalDate(timestamp: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp));
  return parseDateOnly(parts);
}

/**
 * Planned amount of a recurring fee for one month: its full amount for every due date that falls in
 * that month (a quarterly fee counts only in its due months, a yearly one once a year), counted from
 * its start date — not a monthly average spread over every month.
 */
function plannedInMonth(amount: Prisma.Decimal, frequency: string, startDate: Date, range: { start: Date; end: Date }) {
  const day = 86_400_000;
  if (frequency === 'DAILY' || frequency === 'WEEKLY') {
    const step = frequency === 'DAILY' ? 1 : 7;
    const from = Math.max(range.start.getTime(), startDate.getTime());
    if (from >= range.end.getTime()) return new Decimal(0);
    // First due date on or after `from`, then every `step` days until the month ends.
    const offset = Math.ceil((from - startDate.getTime()) / day / step) * step;
    const first = startDate.getTime() + offset * day;
    const count = first >= range.end.getTime() ? 0 : Math.floor((range.end.getTime() - 1 - first) / (step * day)) + 1;
    return amount.mul(count);
  }
  const months = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 }[frequency as 'MONTHLY' | 'QUARTERLY' | 'YEARLY'] ?? 1;
  const diff = (range.start.getUTCFullYear() - startDate.getUTCFullYear()) * 12 + (range.start.getUTCMonth() - startDate.getUTCMonth());
  return diff >= 0 && diff % months === 0 ? amount : new Decimal(0);
}

/**
 * How an amount entered in `currency` is stored: the currency (null = the family's own) and its value
 * in the family currency at today's rate, which every total adds up.
 */
async function pricing(family: Family, amount: string | Prisma.Decimal, currency: Currency | undefined) {
  if (!currency || currency === family.currency) return { currency: null, familyAmount: null };
  return { currency, familyAmount: await convertAmount(new Decimal(amount), currency, family.currency) };
}

/** What an expense or fee is worth in the family currency. */
const familyValue = (item: { amount: Prisma.Decimal; familyAmount: Prisma.Decimal | null }) => item.familyAmount ?? item.amount;

async function getFamily(familyId: string): Promise<Family> {
  const family = await prisma.family.findUnique({ where: { id: familyId } });
  if (!family) throw AppError.unauthorized();
  return family;
}

async function getChild(familyId: string, childId: string) {
  const child = await prisma.familyMember.findFirst({
    where: { id: childId, familyId, type: 'CHILD', isActive: true, deletedAt: null },
  });
  if (!child) throw AppError.notFound('Child not found in this family');
  return child;
}

async function getTutoringCategory(familyId: string) {
  const category = await prisma.category.findFirst({
    where: { familyId, key: 'education', isActive: true },
    include: { subcategories: { where: { key: 'home_tutoring', isActive: true }, take: 1 } },
  });
  if (!category?.subcategories[0]) throw AppError.notFound('Home lessons category is unavailable');
  return { category, subcategory: category.subcategories[0] };
}

/** Wall-clock "YYYY-MM-DD" and "HH:MM" of an instant in `timeZone`. */
function localParts(instant: string, timeZone: string) {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant));
  return { date: localDate(new Date(instant), timeZone), time };
}

/**
 * Creates the payment reminder that goes with a new expense. Skipped when no reminder was asked for
 * or the member isn't allowed to add payments (the expense itself is still saved).
 */
async function attachReminder(
  actor: Actor,
  reminder: ReminderOption | undefined,
  payment: { name: string; amount: string; currency: Currency; category: PaymentCategory; frequency: PaymentFrequency; memberId?: string | null; startDate: string; dueDate: string; dueTime: string; notes?: string | null },
  links: { expenseId?: string; recurringExpenseId?: string; teacherId?: string | null },
) {
  if (!reminder || !can(actor, 'ADD_PAYMENT')) return null;
  return createPayment(
    actor,
    {
      name: payment.name.slice(0, 120),
      amount: payment.amount,
      currency: payment.currency,
      category: payment.category,
      frequency: payment.frequency,
      memberId: payment.memberId ?? null,
      startDate: payment.startDate,
      dueDate: payment.dueDate,
      dueTime: payment.dueTime,
      notes: payment.notes ?? null,
      reminderEnabled: true,
      reminderDaysBefore: reminder.daysBefore,
      reminderTime: reminder.time,
    },
    links,
  );
}

/** Built-in lesson subjects (the app shows them translated); anything else is the family's own text. */
const SUBJECTS: Record<string, { ar: string; en: string }> = {
  math: { ar: 'رياضيات', en: 'Maths' },
  arabic: { ar: 'لغة عربية', en: 'Arabic' },
  english: { ar: 'لغة إنجليزية', en: 'English' },
  science: { ar: 'علوم', en: 'Science' },
  physics: { ar: 'فيزياء', en: 'Physics' },
  chemistry: { ar: 'كيمياء', en: 'Chemistry' },
  biology: { ar: 'أحياء', en: 'Biology' },
  quran: { ar: 'قرآن', en: 'Quran' },
  islamic: { ar: 'تربية إسلامية', en: 'Islamic studies' },
  social: { ar: 'دراسات اجتماعية', en: 'Social studies' },
  french: { ar: 'لغة فرنسية', en: 'French' },
  computer: { ar: 'حاسب آلي', en: 'Computer' },
  art: { ar: 'رسم وفنون', en: 'Art' },
};

function subjectLabel(subject: string, language: 'ar' | 'en') {
  return SUBJECTS[subject]?.[language] ?? subject;
}

/** Subjects this family has used before (for the picker), most recent first. */
export async function listUsedSubjects(actor: Actor) {
  if (!can(actor, 'SERVICE_LESSONS')) return [];
  const rows = await prisma.expense.findMany({
    where: { familyId: actor.familyId, subject: { not: null }, deletedAt: null },
    select: { subject: true },
    distinct: ['subject'],
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  return rows.map((row) => row.subject!);
}

/** "Teacher: name · phone" for the reminder's notes, so the number is at hand when it's time to pay. */
function teacherNote(teacher: { name: string; phone: string | null } | null) {
  return teacher ? [teacher.name, teacher.phone].filter(Boolean).join(' · ') : null;
}

const PLACEHOLDERS = new Set(['Home lesson', 'Household expense']);

function reminderName(language: string, description: string | null | undefined, fallbackAr: string, fallbackEn: string) {
  if (description && !PLACEHOLDERS.has(description)) return description;
  return language === 'ar' ? fallbackAr : fallbackEn;
}

function expenseDto(expense: Expense & {
  family: { currency: Currency };
  createdBy: { id: string; name: string } | null;
  teacher: { id: string; name: string; phone: string | null; subject: string | null } | null;
  _count: { attachments: number };
  member: { id: string; name: string } | null;
  category: { key: string | null; nameAr: string; nameEn: string };
  subcategory: { key: string | null; nameAr: string; nameEn: string } | null;
}) {
  return {
    id: expense.id,
    amount: expense.amount.toString(),
    currency: expense.currency ?? expense.family.currency,
    /** In the family currency; what totals add up. */
    familyAmount: familyValue(expense).toString(),
    description: expense.description,
    date: formatDateOnly(expense.date),
    occurredAt: expense.occurredAt?.toISOString() ?? null,
    ownerType: expense.ownerType,
    member: expense.member,
    category: expense.category,
    subcategory: expense.subcategory,
    isRecurring: expense.isRecurring,
    notes: expense.notes,
    teacher: expense.teacher,
    subject: expense.subject,
    attachmentCount: expense._count.attachments,
    createdBy: expense.createdBy,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
  };
}

const expenseInclude = {
  family: { select: { currency: true } },
  createdBy: { select: { id: true, name: true } },
  teacher: { select: teacherSelect },
  _count: { select: { attachments: true } },
  member: { select: { id: true, name: true } },
  category: { select: { key: true, nameAr: true, nameEn: true } },
  subcategory: { select: { key: true, nameAr: true, nameEn: true } },
} as const;

/** An expense the actor is allowed to see, or 404 (other families' ids are indistinguishable from missing). */
async function visibleExpense(actor: Actor, id: string) {
  const expense = await prisma.expense.findFirst({ where: { AND: [expenseScope(actor), { id, deletedAt: null }] }, include: expenseInclude });
  if (!expense) throw AppError.notFound('Expense not found');
  return expense;
}

export async function getExpense(actor: Actor, id: string) {
  return expenseDto(await visibleExpense(actor, id));
}

export async function deleteExpense(actor: Actor, id: string) {
  assertCan(actor, 'DELETE_EXPENSE');
  await visibleExpense(actor, id);
  await prisma.expense.update({ where: { id }, data: { deletedAt: new Date() } });
  await cancelLinkedPayments({ expenseId: id });
}

export async function updateExpense(actor: Actor, id: string, input: ExpenseUpdateInput) {
  assertCan(actor, 'EDIT_EXPENSE');
  const current = await visibleExpense(actor, id);
  const family = await getFamily(actor.familyId);
  let memberId: string | undefined;
  if (input.childId !== undefined && input.childId !== current.memberId) {
    if (current.ownerType !== 'CHILD') throw AppError.badRequest('Only a lesson can be moved to a child');
    assertOwnChild(actor, current.memberId);
    assertOwnChild(actor, input.childId);
    memberId = (await getChild(actor.familyId, input.childId)).id;
  }
  const teacherChanged = input.teacherId !== undefined || input.newTeacher !== undefined;
  const teacher = teacherChanged ? await resolveTeacher(actor, { ...input, subject: input.subject ?? current.subject }) : undefined;
  const repriced =
    input.amount !== undefined || input.currency !== undefined
      ? await pricing(family, input.amount ?? current.amount, input.currency ?? current.currency ?? family.currency)
      : {};
  const expense = await prisma.expense.update({
    where: { id },
    data: {
      amount: input.amount,
      ...repriced,
      description: input.description,
      notes: input.notes,
      subject: input.subject,
      memberId,
      ...(teacherChanged ? { teacherId: teacher?.id ?? null } : {}),
      ...(input.occurredAt ? { occurredAt: new Date(input.occurredAt), date: toLocalDate(input.occurredAt, family.timezone) } : {}),
    },
    include: expenseInclude,
  });
  // The lesson's reminder follows its teacher.
  if (teacherChanged) await prisma.payment.updateMany({ where: { expenseId: id }, data: { teacherId: teacher?.id ?? null } });
  return expenseDto(expense);
}

function recurringDto(recurring: {
  id: string;
  amount: Prisma.Decimal;
  currency: Currency | null;
  familyAmount: Prisma.Decimal | null;
  family: { currency: Currency };
  description: string;
  frequency: string;
  startDate: Date;
  member: { id: string; name: string } | null;
  category?: { key: string | null };
  subcategory?: { key: string | null; nameAr: string; nameEn: string } | null;
  teacher?: { id: string; name: string; phone: string | null; subject: string | null } | null;
  subject?: string | null;
}) {
  return {
    id: recurring.id,
    amount: recurring.amount.toString(),
    currency: recurring.currency ?? recurring.family.currency,
    familyAmount: familyValue(recurring).toString(),
    description: recurring.description,
    frequency: recurring.frequency,
    startDate: formatDateOnly(recurring.startDate),
    child: recurring.member,
    kind: recurring.category?.key === 'household' ? ('HOUSEHOLD' as const) : ('LESSON' as const),
    section: recurring.category?.key === 'household' ? recurring.subcategory ?? null : null,
    teacher: recurring.teacher ?? null,
    subject: recurring.subject ?? null,
  };
}

const recurringInclude = {
  family: { select: { currency: true } },
  member: { select: { id: true, name: true } },
  teacher: { select: teacherSelect },
  category: { select: { key: true } },
  subcategory: { select: { key: true, nameAr: true, nameEn: true } },
} as const;

export async function getChildDetails(actor: Actor, childId: string) {
  assertOwnChild(actor, childId);
  const familyId = actor.familyId;
  const child = await getChild(familyId, childId);
  const [lessons, recurring] = await Promise.all([
    prisma.expense.findMany({
      where: { AND: [expenseScope(actor), { memberId: child.id, deletedAt: null, subcategory: { key: 'home_tutoring' } }] },
      include: expenseInclude,
      orderBy: [{ occurredAt: 'desc' }, { date: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    }),
    prisma.recurringExpense.findMany({
      where: { AND: [recurringScope(actor), { familyId, memberId: child.id, isActive: true, subcategory: { key: 'home_tutoring' } }] },
      include: recurringInclude,
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  return {
    id: child.id,
    name: child.name,
    school: child.school,
    grade: child.grade,
    dateOfBirth: child.dateOfBirth ? formatDateOnly(child.dateOfBirth) : null,
    lessons: lessons.map(expenseDto),
    recurring: recurring.map(recurringDto),
  };
}

/** Soft-deletes the child and stops their monthly fees; past lessons stay in the history. */
export async function removeChild(actor: Actor, childId: string) {
  assertCan(actor, 'MANAGE_CHILDREN');
  const familyId = actor.familyId;
  const child = await getChild(familyId, childId);
  const fees = await prisma.recurringExpense.findMany({ where: { familyId, memberId: child.id, isActive: true }, select: { id: true } });
  await prisma.$transaction([
    prisma.familyMember.update({ where: { id: child.id }, data: { isActive: false, deletedAt: new Date() } }),
    prisma.recurringExpense.updateMany({ where: { familyId, memberId: child.id, isActive: true }, data: { isActive: false } }),
  ]);
  await cancelLinkedPayments({ recurringExpenseId: { in: fees.map((fee) => fee.id) } });
}

export async function listRecurringTuition(actor: Actor, childId?: string) {
  if (childId) assertOwnChild(actor, childId);
  const rows = await prisma.recurringExpense.findMany({
    where: {
      AND: [
        // Visibility (children, VIEW_EXPENSES, service switches) comes from the access layer.
        recurringScope(actor),
        { familyId: actor.familyId, isActive: true },
        // A child filter means that child's lesson fees only.
        childId ? { memberId: childId, subcategory: { key: 'home_tutoring' } } : {},
      ],
    },
    include: recurringInclude,
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(recurringDto);
}

export async function stopRecurring(actor: Actor, id: string) {
  assertCan(actor, 'DELETE_EXPENSE');
  const { count } = await prisma.recurringExpense.updateMany({
    where: { AND: [recurringScope(actor), { id, familyId: actor.familyId, isActive: true }] },
    data: { isActive: false },
  });
  if (!count) throw AppError.notFound('Monthly fee not found');
  await cancelLinkedPayments({ recurringExpenseId: id });
}

async function getHouseholdCategory(familyId: string) {
  const category = await prisma.category.findFirst({ where: { familyId, key: 'household', isActive: true } });
  if (!category) throw AppError.notFound('Household category is unavailable');
  return category;
}

export async function listHouseholdSections(actor: Actor) {
  const category = await getHouseholdCategory(actor.familyId);
  return prisma.subcategory.findMany({
    where: { categoryId: category.id, isActive: true },
    select: { id: true, key: true, nameAr: true, nameEn: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function createHouseholdSection(actor: Actor, input: SectionInput) {
  assertAdmin(actor);
  const category = await getHouseholdCategory(actor.familyId);
  const duplicate = await prisma.subcategory.findFirst({
    where: { categoryId: category.id, isActive: true, nameAr: { equals: input.name, mode: 'insensitive' } },
  });
  if (duplicate) throw AppError.conflict('هذا القسم موجود بالفعل');
  const last = await prisma.subcategory.aggregate({ where: { categoryId: category.id }, _max: { sortOrder: true } });
  return prisma.subcategory.create({
    data: {
      categoryId: category.id,
      key: `custom_${randomUUID().slice(0, 8)}`,
      nameAr: input.name,
      nameEn: input.name,
      sortOrder: (last._max.sortOrder ?? 0) + 1,
    },
    select: { id: true, key: true, nameAr: true, nameEn: true },
  });
}

/** Hides the section from new entries; expenses already filed under it keep their label. */
export async function removeHouseholdSection(actor: Actor, id: string) {
  assertAdmin(actor);
  const category = await getHouseholdCategory(actor.familyId);
  const { count } = await prisma.subcategory.updateMany({
    where: { id, categoryId: category.id, isActive: true },
    data: { isActive: false },
  });
  if (!count) throw AppError.notFound('Section not found');
}

export async function listChildren(actor: Actor) {
  return prisma.familyMember.findMany({
    where: { ...childScope(actor), type: 'CHILD', isActive: true, deletedAt: null },
    select: { id: true, name: true, grade: true, school: true },
    orderBy: { createdAt: 'asc' },
  });
}

export async function createChild(actor: Actor, input: ChildInput) {
  assertCan(actor, 'MANAGE_CHILDREN');
  return prisma.familyMember.create({
    data: {
      familyId: actor.familyId,
      name: input.name,
      type: 'CHILD',
      dateOfBirth: input.dateOfBirth ? parseDateOnly(input.dateOfBirth) : undefined,
      school: input.school,
      grade: input.grade,
    },
    select: { id: true, name: true, dateOfBirth: true, school: true, grade: true },
  });
}

export async function createHomeLesson(actor: Actor, input: LessonExpenseInput) {
  assertCan(actor, 'ADD_EXPENSE');
  assertCan(actor, 'SERVICE_LESSONS');
  assertOwnChild(actor, input.childId);
  const familyId = actor.familyId;
  const [family, child, lookup] = await Promise.all([
    getFamily(familyId),
    getChild(familyId, input.childId),
    getTutoringCategory(familyId),
  ]);
  const date = toLocalDate(input.occurredAt, family.timezone);
  const price = await pricing(family, input.amount, input.currency);
  const teacher = await resolveTeacher(actor, input);
  const expense = await prisma.expense.create({
    data: {
      familyId,
      ownerType: 'CHILD',
      memberId: child.id,
      categoryId: lookup.category.id,
      subcategoryId: lookup.subcategory.id,
      amount: input.amount,
      ...price,
      description: input.description || 'Home lesson',
      date,
      occurredAt: new Date(input.occurredAt),
      createdById: actor.userId,
      teacherId: teacher?.id ?? null,
      subject: input.subject ?? null,
    },
    include: expenseInclude,
  });
  // A lesson in the future gets a reminder for its date and time.
  const due = localParts(input.occurredAt, actor.timezone);
  const reminder = new Date(input.occurredAt) > new Date()
    ? await attachReminder(
        actor,
        input.reminder,
        {
          name: reminderName(
            family.language,
            input.description,
            input.subject ? `درس ${subjectLabel(input.subject, 'ar')} · ${child.name}` : `درس ${child.name}`,
            input.subject ? `${subjectLabel(input.subject, 'en')} lesson · ${child.name}` : `${child.name} lesson`,
          ),
          amount: input.amount,
          currency: input.currency ?? family.currency,
          category: 'TUITION',
          frequency: 'ONCE',
          memberId: child.id,
          startDate: due.date,
          dueDate: due.date,
          dueTime: due.time,
          notes: teacherNote(teacher),
        },
        { expenseId: expense.id, teacherId: teacher?.id ?? null },
      )
    : null;
  return { ...expenseDto(expense), reminder };
}

export async function createRecurringHomeTuition(actor: Actor, input: RecurringLessonInput) {
  assertCan(actor, 'ADD_EXPENSE');
  assertCan(actor, 'SERVICE_LESSONS');
  assertCan(actor, 'SERVICE_RECURRING');
  assertOwnChild(actor, input.childId);
  const familyId = actor.familyId;
  const [family, child, lookup] = await Promise.all([
    getFamily(familyId),
    getChild(familyId, input.childId),
    getTutoringCategory(familyId),
  ]);
  const startDate = input.startDate ? parseDateOnly(input.startDate) : todayInTimeZone(family.timezone);
  const price = await pricing(family, input.amount, input.currency);
  const teacher = await resolveTeacher(actor, input);
  const recurring = await prisma.recurringExpense.create({
    data: {
      familyId,
      teacherId: teacher?.id ?? null,
      subject: input.subject ?? null,
      ownerType: 'CHILD',
      memberId: child.id,
      categoryId: lookup.category.id,
      subcategoryId: lookup.subcategory.id,
      amount: input.amount,
      ...price,
      description: input.description,
      frequency: input.frequency,
      startDate,
      nextOccurrence: startDate,
    },
    include: recurringInclude,
  });
  const start = formatDateOnly(startDate);
  const reminder = await attachReminder(
    actor,
    input.reminder,
    {
      name: input.description,
      amount: input.amount,
      currency: input.currency ?? family.currency,
      category: 'TUITION',
      frequency: input.frequency,
      memberId: child.id,
      notes: teacherNote(teacher),
      startDate: start,
      dueDate: firstDueOnOrAfter(start, input.frequency, localDate(new Date(), actor.timezone)),
      dueTime: input.dueTime,
    },
    { recurringExpenseId: recurring.id, teacherId: teacher?.id ?? null },
  );
  return { ...recurringDto(recurring), reminder };
}

export async function createRecurringHousehold(actor: Actor, input: RecurringHouseholdInput) {
  assertCan(actor, 'ADD_EXPENSE');
  assertCan(actor, 'SERVICE_HOUSEHOLD');
  assertCan(actor, 'SERVICE_RECURRING');
  const familyId = actor.familyId;
  const [family, category] = await Promise.all([getFamily(familyId), getHouseholdCategory(familyId)]);
  const subcategory = input.subcategoryKey
    ? await prisma.subcategory.findFirst({ where: { categoryId: category.id, key: input.subcategoryKey, isActive: true } })
    : null;
  if (input.subcategoryKey && !subcategory) throw AppError.notFound('Household subcategory not found');
  const startDate = input.startDate ? parseDateOnly(input.startDate) : todayInTimeZone(family.timezone);
  const price = await pricing(family, input.amount, input.currency);
  const recurring = await prisma.recurringExpense.create({
    data: {
      familyId,
      ...(actor.role === 'CHILD' && actor.memberId ? { ownerType: 'CHILD' as const, memberId: actor.memberId } : { ownerType: 'HOUSEHOLD' as const }),
      categoryId: category.id,
      subcategoryId: subcategory?.id,
      amount: input.amount,
      ...price,
      description: input.description,
      frequency: input.frequency,
      startDate,
      nextOccurrence: startDate,
    },
    include: recurringInclude,
  });
  const start = formatDateOnly(startDate);
  const reminder = await attachReminder(
    actor,
    input.reminder,
    {
      name: input.description,
      amount: input.amount,
      currency: input.currency ?? family.currency,
      category: 'BILL',
      frequency: input.frequency,
      startDate: start,
      dueDate: firstDueOnOrAfter(start, input.frequency, localDate(new Date(), actor.timezone)),
      dueTime: input.dueTime,
    },
    { recurringExpenseId: recurring.id },
  );
  return { ...recurringDto(recurring), reminder };
}

export async function createHouseholdExpense(actor: Actor, input: HouseholdExpenseInput) {
  assertCan(actor, 'ADD_EXPENSE');
  assertCan(actor, 'SERVICE_HOUSEHOLD');
  const familyId = actor.familyId;
  const [family, category] = await Promise.all([
    getFamily(familyId),
    prisma.category.findFirst({ where: { familyId, key: 'household', isActive: true } }),
  ]);
  if (!category) throw AppError.notFound('Household category is unavailable');

  const subcategory = input.subcategoryKey
    ? await prisma.subcategory.findFirst({
        where: { categoryId: category.id, key: input.subcategoryKey, isActive: true },
      })
    : null;
  if (input.subcategoryKey && !subcategory) throw AppError.notFound('Household subcategory not found');

  const price = await pricing(family, input.amount, input.currency);
  const expense = await prisma.expense.create({
    data: {
      familyId,
      // A child's purchase is recorded as their own personal expense.
      ...(actor.role === 'CHILD' && actor.memberId ? { ownerType: 'CHILD' as const, memberId: actor.memberId } : { ownerType: 'HOUSEHOLD' as const }),
      categoryId: category.id,
      subcategoryId: subcategory?.id,
      createdById: actor.userId,
      amount: input.amount,
      ...price,
      description: input.description || 'Household expense',
      date: toLocalDate(input.occurredAt, family.timezone),
      occurredAt: new Date(input.occurredAt),
    },
    include: expenseInclude,
  });
  // A future household expense gets a reminder for its date and time.
  const due = localParts(input.occurredAt, actor.timezone);
  const reminder = new Date(input.occurredAt) > new Date()
    ? await attachReminder(
        actor,
        input.reminder,
        {
          name: reminderName(family.language, input.description, subcategory?.nameAr ?? 'مصروف منزلي', subcategory?.nameEn ?? 'Household expense'),
          amount: input.amount,
          currency: input.currency ?? family.currency,
          category: 'BILL',
          frequency: 'ONCE',
          memberId: actor.role === 'CHILD' ? actor.memberId : null,
          startDate: due.date,
          dueDate: due.date,
          dueTime: due.time,
        },
        { expenseId: expense.id },
      )
    : null;
  return { ...expenseDto(expense), reminder };
}

export async function getMonthlyFinance(actor: Actor, requestedMonth?: string) {
  const familyId = actor.familyId;
  const family = await getFamily(familyId);
  const month = requestedMonth ?? monthInTimeZone(family.timezone);
  const [year, monthNumber] = month.split('-').map(Number);
  const range = monthRange(year, monthNumber);

  const [expenses, recurringExpenses] = await Promise.all([
    prisma.expense.findMany({
      where: { AND: [expenseScope(actor), { deletedAt: null, date: { gte: range.start, lt: range.end } }] },
      include: expenseInclude,
      orderBy: [{ occurredAt: 'desc' }, { date: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.recurringExpense.findMany({
      where: {
        familyId,
        isActive: true,
        startDate: { lt: range.end },
        AND: [
          recurringScope(actor),
          { OR: [{ endDate: null }, { endDate: { gte: range.start } }] },
          { OR: [{ category: { key: 'household' } }, { subcategory: { key: 'home_tutoring' } }] },
        ],
      },
      include: {
        member: { select: { id: true, name: true } },
        category: { select: { key: true } },
        subcategory: { select: { key: true } },
      },
    }),
  ]);

  const postedRecurringIds = new Set(expenses.map((item) => item.recurringExpenseId).filter(Boolean));
  const plannedRecurring = recurringExpenses.filter((item) => !postedRecurringIds.has(item.id));
  const householdSpent = expenses
    .filter((item) => item.category.key === 'household')
    .reduce((total, item) => total.plus(familyValue(item)), new Decimal(0));
  const tutoringSpent = expenses
    .filter((item) => item.category.key === 'education' && item.subcategory?.key === 'home_tutoring')
    .reduce((total, item) => total.plus(familyValue(item)), new Decimal(0));
  // Everything else (food, transport, health, paid bills…) still counts toward the month's spending.
  const otherSpent = expenses
    .filter((item) => item.category.key !== 'household' && !(item.category.key === 'education' && item.subcategory?.key === 'home_tutoring'))
    .reduce((total, item) => total.plus(familyValue(item)), new Decimal(0));
  const householdPlanned = plannedRecurring
    .filter((item) => item.category.key === 'household')
    .reduce((total, item) => total.plus(plannedInMonth(familyValue(item), item.frequency, item.startDate, range)), new Decimal(0));
  const tutoringPlannedRows = plannedRecurring.filter(
    (item) => item.category.key === 'education' && item.subcategory?.key === 'home_tutoring',
  );
  const tutoringPlanned = tutoringPlannedRows.reduce(
    (total, item) => total.plus(plannedInMonth(familyValue(item), item.frequency, item.startDate, range)),
    new Decimal(0),
  );

  const children = new Map<string, { childId: string; childName: string; sessionAmount: Prisma.Decimal; recurringAmount: Prisma.Decimal }>();
  for (const item of expenses) {
    if (item.category.key !== 'education' || item.subcategory?.key !== 'home_tutoring' || !item.member) continue;
    const child = children.get(item.member.id) ?? {
      childId: item.member.id,
      childName: item.member.name,
      sessionAmount: new Decimal(0),
      recurringAmount: new Decimal(0),
    };
    if (item.recurringExpenseId) child.recurringAmount = child.recurringAmount.plus(familyValue(item));
    else child.sessionAmount = child.sessionAmount.plus(familyValue(item));
    children.set(item.member.id, child);
  }
  for (const item of tutoringPlannedRows) {
    if (!item.member) continue;
    const child = children.get(item.member.id) ?? {
      childId: item.member.id,
      childName: item.member.name,
      sessionAmount: new Decimal(0),
      recurringAmount: new Decimal(0),
    };
    child.recurringAmount = child.recurringAmount.plus(plannedInMonth(familyValue(item), item.frequency, item.startDate, range));
    children.set(item.member.id, child);
  }

  return {
    month,
    currency: family.currency,
    household: {
      spentAmount: toMoneyString(householdSpent, family.currency),
      plannedRecurringAmount: toMoneyString(householdPlanned, family.currency),
      totalAmount: toMoneyString(householdSpent.plus(householdPlanned), family.currency),
    },
    homeLessons: {
      spentAmount: toMoneyString(tutoringSpent, family.currency),
      plannedRecurringAmount: toMoneyString(tutoringPlanned, family.currency),
      totalAmount: toMoneyString(tutoringSpent.plus(tutoringPlanned), family.currency),
      perChild: [...children.values()].map((child) => ({
        childId: child.childId,
        childName: child.childName,
        sessionAmount: toMoneyString(child.sessionAmount, family.currency),
        recurringAmount: toMoneyString(child.recurringAmount, family.currency),
        totalAmount: toMoneyString(child.sessionAmount.plus(child.recurringAmount), family.currency),
      })),
    },
    other: { spentAmount: toMoneyString(otherSpent, family.currency) },
    /** All spending this month: actual expenses in every category + planned recurring fees. */
    totalAmount: toMoneyString(householdSpent.plus(householdPlanned).plus(tutoringSpent).plus(tutoringPlanned).plus(otherSpent), family.currency),
    expenses: expenses.map(expenseDto),
  };
}