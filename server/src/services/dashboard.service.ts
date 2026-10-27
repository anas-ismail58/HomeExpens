import { prisma } from '../config/prisma';
import { Decimal, toMoneyString } from '../utils/money';
import { can, type Actor } from './access.service';
import { getMonthlyFinance } from './finance.service';
import { listMembers } from './family.service';
import { getIncomeSummary } from './income.service';
import { paymentSummary } from './payment.service';
import { processDueNotifications } from './scheduler.service';

/** Everything the home screen needs in one call, already filtered to what the caller may see. */
export async function getDashboard(actor: Actor, month?: string) {
  await processDueNotifications({ familyId: actor.familyId }).catch(() => undefined);
  const seesIncome = can(actor, 'VIEW_INCOME') && actor.role !== 'CHILD';
  const report = await getMonthlyFinance(actor, month);

  const [payments, members, budget, unreadNotifications] = await Promise.all([
    paymentSummary(actor),
    listMembers(actor, actor.familyId),
    seesIncome ? getIncomeSummary(actor, report.month) : null,
    prisma.notification.count({ where: { userId: actor.userId, isRead: false, type: { not: 'CHILD_POINTS' } } }),
  ]);

  // Same total as the home hero: actual + planned recurring, limited to what this member may see.
  const expenses = new Decimal(report.totalAmount);
  return {
    month: report.month,
    currency: report.currency,
    totals: {
      income: budget?.totals.income ?? null,
      salary: budget?.totals.salary ?? null,
      expenses: budget?.totals.expenses ?? toMoneyString(expenses, report.currency),
      /** Of the expenses: recurring fees and bills planned this month but not posted yet. */
      planned: toMoneyString(new Decimal(report.household.plannedRecurringAmount).plus(report.homeLessons.plannedRecurringAmount), report.currency),
      /** Lessons this month (actual + planned fees), the same way the expenses are counted. */
      lessons: report.homeLessons.totalAmount,
      lessonsPlanned: report.homeLessons.plannedRecurringAmount,
      /** The viewer's own savings moved to their vault this month (taken off the balance); shown hidden. */
      savedToVault: budget?.totals.savedToVault ?? null,
      balance: budget?.totals.remaining ?? null,
      spentRatio: budget?.totals.spentRatio ?? null,
      /** This month's payments not paid yet (pending): taken off the balance only once paid. */
      payments: report.payments.amount,
      paymentsCount: report.payments.count,
      paymentsByCurrency: report.payments.byCurrency,
      stillToPay: report.payments.amount,
      /** The balance once the pending payments are paid. */
      afterPaying: budget?.totals.afterPending ?? null,
      hasSalary: Boolean(budget?.salary),
    },
    payments,
    recentExpenses: report.expenses.slice(0, 5),
    members,
    unreadNotifications,
  };
}
