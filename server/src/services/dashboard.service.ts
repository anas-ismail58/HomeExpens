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
    prisma.notification.count({ where: { userId: actor.userId, isRead: false } }),
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
      balance: budget?.totals.remaining ?? null,
      spentRatio: budget?.totals.spentRatio ?? null,
      hasSalary: Boolean(budget?.salary),
    },
    payments,
    recentExpenses: report.expenses.slice(0, 5),
    members,
    unreadNotifications,
  };
}
