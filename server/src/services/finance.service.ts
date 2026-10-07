import type { Expense, Family, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { Decimal, toMoneyString } from '../utils/money';
import { formatDateOnly, monthRange, parseDateOnly, todayInTimeZone } from '../utils/dates';
import { AppError } from '../utils/AppError';
import { randomUUID } from 'node:crypto';
import type { ChildInput, SectionInput, HouseholdExpenseInput, LessonExpenseInput, RecurringLessonInput, ExpenseUpdateInput, RecurringHouseholdInput, ReminderOption } from '../validators/finance.validator';
import type { PaymentCategory, PaymentFrequency } from '@prisma/client';
import { cancelLinkedPayments, createPayment, firstDueOnOrAfter } from './payment.service';
import { localDate } from '../utils/time';
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

function monthlyEquivalent(amount: Prisma.Decimal, frequency: string) {
  const factor: Record<string, string> = {
    DAILY: '365/12',
    WEEKLY: '52/12',
    MONTHLY: '1',
    QUARTERLY: '1/3',
    YEARLY: '1/12',
  };
  const [numerator, denominator = '1'] = (factor[frequency] ?? '0').split('/');
  return amount.mul(numerator).div(denominator).toDecimalPlaces(3);
}

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
  payment: { name: string; amount: string; category: PaymentCategory; frequency: PaymentFrequency; memberId?: string | null; startDate: string; dueDate: string; dueTime: string; notes?: string | null },
  links: { expenseId?: string; recurringExpenseId?: string },
) {
  if (!reminder || !can(actor, 'ADD_PAYMENT')) return null;
  return createPayment(
    actor,
    {
      name: payment.name.slice(0, 120),
      amount: payment.amount,
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
    attachmentCount: expense._count.attachments,
    createdBy: expense.createdBy,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
  };
}

const expenseInclude = {
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
  await visibleExpense(actor, id);
  const family = await getFamily(actor.familyId);
  const expense = await prisma.expense.update({
    where: { id },
    data: {
      amount: input.amount,
      description: input.description,
      notes: input.notes,
      ...(input.teacherId !== undefined ? { teacherId: input.teacherId ? (await resolveTeacher(actor, { teacherId: input.teacherId }))!.id : null } : {}),
      ...(input.occurredAt ? { occurredAt: new Date(input.occurredAt), date: toLocalDate(input.occurredAt, family.timezone) } : {}),
    },
    include: expenseInclude,
  });
  return expenseDto(expense);
}

function recurringDto(recurring: {
  id: string;
  amount: Prisma.Decimal;
  description: string;
  frequency: string;
  startDate: Date;
  member: { id: string; name: string } | null;
  category?: { key: string | null };
  subcategory?: { key: string | null; nameAr: string; nameEn: string } | null;
  teacher?: { id: string; name: string; phone: string | null; subject: string | null } | null;
}) {
  return {
    id: recurring.id,
    amount: recurring.amount.toString(),
    description: recurring.description,
    frequency: recurring.frequency,
    startDate: formatDateOnly(recurring.startDate),
    child: recurring.member,
    kind: recurring.category?.key === 'household' ? ('HOUSEHOLD' as const) : ('LESSON' as const),
    section: recurring.category?.key === 'household' ? recurring.subcategory ?? null : null,
    teacher: recurring.teacher ?? null,
  };
}

const recurringInclude = {
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
  const teacher = await resolveTeacher(actor, input);
  const expense = await prisma.expense.create({
    data: {
      familyId,
      ownerType: 'CHILD',
      memberId: child.id,
      categoryId: lookup.category.id,
      subcategoryId: lookup.subcategory.id,
      amount: input.amount,
      description: input.description || 'Home lesson',
      date,
      occurredAt: new Date(input.occurredAt),
      createdById: actor.userId,
      teacherId: teacher?.id ?? null,
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
          name: reminderName(family.language, input.description, `درس ${child.name}`, `${child.name} lesson`),
          amount: input.amount,
          category: 'TUITION',
          frequency: 'ONCE',
          memberId: child.id,
          startDate: due.date,
          dueDate: due.date,
          dueTime: due.time,
          notes: teacherNote(teacher),
        },
        { expenseId: expense.id },
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
  const teacher = await resolveTeacher(actor, input);
  const recurring = await prisma.recurringExpense.create({
    data: {
      familyId,
      teacherId: teacher?.id ?? null,
      ownerType: 'CHILD',
      memberId: child.id,
      categoryId: lookup.category.id,
      subcategoryId: lookup.subcategory.id,
      amount: input.amount,
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
      category: 'TUITION',
      frequency: input.frequency,
      memberId: child.id,
      notes: teacherNote(teacher),
      startDate: start,
      dueDate: firstDueOnOrAfter(start, input.frequency, localDate(new Date(), actor.timezone)),
      dueTime: input.dueTime,
    },
    { recurringExpenseId: recurring.id },
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
  const recurring = await prisma.recurringExpense.create({
    data: {
      familyId,
      ...(actor.role === 'CHILD' && actor.memberId ? { ownerType: 'CHILD' as const, memberId: actor.memberId } : { ownerType: 'HOUSEHOLD' as const }),
      categoryId: category.id,
      subcategoryId: subcategory?.id,
      amount: input.amount,
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

  const expense = await prisma.expense.create({
    data: {
      familyId,
      // A child's purchase is recorded as their own personal expense.
      ...(actor.role === 'CHILD' && actor.memberId ? { ownerType: 'CHILD' as const, memberId: actor.memberId } : { ownerType: 'HOUSEHOLD' as const }),
      categoryId: category.id,
      subcategoryId: subcategory?.id,
      createdById: actor.userId,
      amount: input.amount,
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
    .reduce((total, item) => total.plus(item.amount), new Decimal(0));
  const tutoringSpent = expenses
    .filter((item) => item.category.key === 'education' && item.subcategory?.key === 'home_tutoring')
    .reduce((total, item) => total.plus(item.amount), new Decimal(0));
  const householdPlanned = plannedRecurring
    .filter((item) => item.category.key === 'household')
    .reduce((total, item) => total.plus(monthlyEquivalent(item.amount, item.frequency)), new Decimal(0));
  const tutoringPlannedRows = plannedRecurring.filter(
    (item) => item.category.key === 'education' && item.subcategory?.key === 'home_tutoring',
  );
  const tutoringPlanned = tutoringPlannedRows.reduce(
    (total, item) => total.plus(monthlyEquivalent(item.amount, item.frequency)),
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
    if (item.recurringExpenseId) child.recurringAmount = child.recurringAmount.plus(item.amount);
    else child.sessionAmount = child.sessionAmount.plus(item.amount);
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
    child.recurringAmount = child.recurringAmount.plus(monthlyEquivalent(item.amount, item.frequency));
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
    expenses: expenses.map(expenseDto),
  };
}