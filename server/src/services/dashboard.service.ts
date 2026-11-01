import { prisma } from '../config/prisma';
import { Decimal, toMoneyString } from '../utils/money';
import { can, type Actor } from './access.service';
import { getMonthlyFinance } from './finance.service';
import { listMembers } from './family.service';
import { getIncomeSummary } from './income.service';
import { listBankAccounts } from './bank.service';
import { paymentSummary } from './payment.service';
import { processDueNotifications } from './scheduler.service';

/** Everything the home screen needs in one call, already filtered to what the caller may see. */
export async function getDashboard(actor: Actor, month?: string) {
  await processDueNotifications({ familyId: actor.familyId }).catch(() => undefined);
  const seesIncome = can(actor, 'VIEW_INCOME') && actor.role !== 'CHILD';
  const report = await getMonthlyFinance(actor, month);

  const [payments, members, budget, unreadNotifications, bank] = await Promise.all([
    paymentSummary(actor),
    listMembers(actor, actor.familyId),
    seesIncome ? getIncomeSummary(actor, report.month) : null,
    prisma.notification.count({ where: { userId: actor.userId, isRead: false, type: { not: 'CHILD_POINTS' } } }),
    // The viewer's own bank savings (adults only).
    actor.role === 'CHILD' ? null : listBankAccounts(actor).catch(() => null),
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
      /** The pending payments the salary will pay (personal-funded ones come off personal funds instead). */
      stillToPay: report.payments.salaryAmount,
      /** The balance once the pending payments are paid. */
      afterPaying: budget?.totals.afterPending ?? null,
      hasSalary: Boolean(budget?.salary),
      /** All money in this month (salary, personal funds, contributions, borrowed…) and what is left of it. */
      totalAvailable: budget?.totals.totalAvailable ?? null,
      remainingAvailable: budget?.totals.remainingAvailable ?? null,
      /** Who paid for the month's spending, and the personal funds put in and left after it. */
      fundedBy: budget?.totals.fundedBy ?? null,
      personalFunds: budget?.totals.personalFunds ?? null,
      remainingPersonal: budget?.totals.remainingPersonal ?? null,
      /** Pending payments funded by personal funds, and what personal funds will have left once they are paid. */
      pendingPersonal: budget?.totals.pendingPersonal ?? null,
      personalAfterPending: budget?.totals.personalAfterPending ?? null,
      /** The viewer's personal money this month: limit and how much was put in (the rest is above). */
      personalLimit: budget?.personal.limit ?? null,
      personalAllocated: budget?.personal.allocated ?? null,
      /** Bank savings: per currency, and in the family currency when rates allow. */
      bankSavings: bank && bank.accounts.length ? { totals: bank.totals, combined: bank.combined } : null,
      /** Money moved between the salary, personal money and bank savings this month. */
      transfers: budget?.totals.transfers ?? null,
    },
    payments,
    recentExpenses: report.expenses.slice(0, 5),
    members,
    unreadNotifications,
  };
}
