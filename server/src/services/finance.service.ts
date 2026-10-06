import type { Expense, Family, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { Decimal, toMoneyString } from '../utils/money';
import { formatDateOnly, monthRange, parseDateOnly, todayInTimeZone } from '../utils/dates';
import { AppError } from '../utils/AppError';
import type { ChildInput, HouseholdExpenseInput, LessonExpenseInput, RecurringLessonInput } from '../validators/finance.validator';

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

function expenseDto(expense: Expense & {
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
  };
}

export async function listChildren(familyId: string) {
  return prisma.familyMember.findMany({
    where: { familyId, type: 'CHILD', isActive: true, deletedAt: null },
    select: { id: true, name: true, grade: true, school: true },
    orderBy: { createdAt: 'asc' },
  });
}

export async function createChild(familyId: string, input: ChildInput) {
  return prisma.familyMember.create({
    data: {
      familyId,
      name: input.name,
      type: 'CHILD',
      dateOfBirth: input.dateOfBirth ? parseDateOnly(input.dateOfBirth) : undefined,
      school: input.school,
      grade: input.grade,
    },
    select: { id: true, name: true, dateOfBirth: true, school: true, grade: true },
  });
}

export async function createHomeLesson(familyId: string, input: LessonExpenseInput) {
  const [family, child, lookup] = await Promise.all([
    getFamily(familyId),
    getChild(familyId, input.childId),
    getTutoringCategory(familyId),
  ]);
  const date = toLocalDate(input.occurredAt, family.timezone);
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
    },
    include: {
      member: { select: { id: true, name: true } },
      category: { select: { key: true, nameAr: true, nameEn: true } },
      subcategory: { select: { key: true, nameAr: true, nameEn: true } },
    },
  });
  return expenseDto(expense);
}

export async function createRecurringHomeTuition(familyId: string, input: RecurringLessonInput) {
  const [family, child, lookup] = await Promise.all([
    getFamily(familyId),
    getChild(familyId, input.childId),
    getTutoringCategory(familyId),
  ]);
  const startDate = input.startDate ? parseDateOnly(input.startDate) : todayInTimeZone(family.timezone);
  const recurring = await prisma.recurringExpense.create({
    data: {
      familyId,
      ownerType: 'CHILD',
      memberId: child.id,
      categoryId: lookup.category.id,
      subcategoryId: lookup.subcategory.id,
      amount: input.amount,
      description: input.description,
      frequency: 'MONTHLY',
      startDate,
      nextOccurrence: startDate,
    },
    include: { member: { select: { id: true, name: true } } },
  });
  return {
    id: recurring.id,
    child: recurring.member,
    amount: recurring.amount.toString(),
    description: recurring.description,
    startDate: formatDateOnly(recurring.startDate),
    frequency: recurring.frequency,
  };
}

export async function createHouseholdExpense(familyId: string, input: HouseholdExpenseInput) {
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
      ownerType: 'HOUSEHOLD',
      categoryId: category.id,
      subcategoryId: subcategory?.id,
      amount: input.amount,
      description: input.description || 'Household expense',
      date: toLocalDate(input.occurredAt, family.timezone),
      occurredAt: new Date(input.occurredAt),
    },
    include: {
      member: { select: { id: true, name: true } },
      category: { select: { key: true, nameAr: true, nameEn: true } },
      subcategory: { select: { key: true, nameAr: true, nameEn: true } },
    },
  });
  return expenseDto(expense);
}

export async function getMonthlyFinance(familyId: string, requestedMonth?: string) {
  const family = await getFamily(familyId);
  const month = requestedMonth ?? monthInTimeZone(family.timezone);
  const [year, monthNumber] = month.split('-').map(Number);
  const range = monthRange(year, monthNumber);

  const [expenses, recurringExpenses] = await Promise.all([
    prisma.expense.findMany({
      where: { familyId, deletedAt: null, date: { gte: range.start, lt: range.end } },
      include: {
        member: { select: { id: true, name: true } },
        category: { select: { key: true, nameAr: true, nameEn: true } },
        subcategory: { select: { key: true, nameAr: true, nameEn: true } },
      },
      orderBy: [{ occurredAt: 'desc' }, { date: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.recurringExpense.findMany({
      where: {
        familyId,
        isActive: true,
        startDate: { lt: range.end },
        AND: [
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