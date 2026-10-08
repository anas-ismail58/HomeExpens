import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { formatDateOnly } from '../utils/dates';
import { Decimal, toMoneyString } from '../utils/money';
import { assertCan, expenseScope, paymentScope, recurringScope, type Actor } from './access.service';
import { paymentDto } from './payment.service';
import { teacherSelect } from './teacher.service';

const person = { select: { id: true, name: true } } as const;

/**
 * A teacher's page: contact, the lessons they gave (with what was paid), their recurring fees and the
 * payments that go to them. Each list only holds what the viewer may see elsewhere in the app.
 */
export async function getTeacherProfile(actor: Actor, id: string) {
  assertCan(actor, 'SERVICE_LESSONS');
  const teacher = await prisma.teacher.findFirst({ where: { id, familyId: actor.familyId }, select: { ...teacherSelect, notes: true, deletedAt: true } });
  if (!teacher) throw AppError.notFound('Teacher not found');

  const [family, lessons, fees, payments] = await Promise.all([
    prisma.family.findUniqueOrThrow({ where: { id: actor.familyId }, select: { currency: true } }),
    prisma.expense.findMany({
      where: { AND: [expenseScope(actor), { teacherId: id, deletedAt: null }] },
      select: { id: true, amount: true, currency: true, familyAmount: true, description: true, subject: true, date: true, member: person },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    }),
    prisma.recurringExpense.findMany({
      where: { AND: [recurringScope(actor), { teacherId: id, isActive: true }] },
      select: { id: true, amount: true, currency: true, description: true, frequency: true, subject: true, member: person },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.payment.findMany({
      where: { AND: [paymentScope(actor), { teacherId: id, deletedAt: null }] },
      include: { createdBy: person, assignee: person, lastPaidBy: person, member: person, teacher: { select: teacherSelect } },
      orderBy: { dueAt: 'asc' },
      take: 200,
    }),
  ]);

  const currency = family.currency;
  const total = lessons.reduce((sum, lesson) => sum.plus(lesson.familyAmount ?? lesson.amount), new Decimal(0));
  const now = new Date();
  const { deletedAt, ...contact } = teacher;
  return {
    ...contact,
    removed: deletedAt != null,
    currency,
    lessonsCount: lessons.length,
    /** Everything recorded for this teacher's lessons, in the family currency. */
    lessonsTotal: toMoneyString(total, currency),
    lessons: lessons.map((lesson) => ({
      id: lesson.id,
      amount: lesson.amount.toString(),
      currency: lesson.currency ?? currency,
      familyAmount: (lesson.familyAmount ?? lesson.amount).toString(),
      description: lesson.description,
      subject: lesson.subject,
      date: formatDateOnly(lesson.date),
      child: lesson.member,
    })),
    fees: fees.map((fee) => ({
      id: fee.id,
      amount: fee.amount.toString(),
      currency: fee.currency ?? currency,
      description: fee.description,
      frequency: fee.frequency,
      subject: fee.subject,
      child: fee.member,
    })),
    payments: payments.map((payment) => paymentDto(payment, now)),
  };
}
