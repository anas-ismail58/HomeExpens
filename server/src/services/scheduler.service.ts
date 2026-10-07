import { Prisma, type DispatchKind } from '@prisma/client';
import { prisma } from '../config/prisma';
import { formatDateOnly } from '../utils/dates';
import { localDate } from '../utils/time';
import { notifyUsers } from './notification.service';

/** Reminders older than this are stale (e.g. the scheduler was down) and are skipped, not sent late. */
const REMINDER_GRACE_MS = 24 * 3_600_000;
/** Overdue alerts are only sent for payments that became overdue within this window. */
const OVERDUE_WINDOW_MS = 7 * 24 * 3_600_000;
/** Overdue alerts wait a little after the due time so they don't arrive together with an on-time reminder. */
const OVERDUE_DELAY_MS = 60 * 60_000;
const BATCH = 200;

type Candidate = Prisma.PaymentGetPayload<{ include: { family: { select: { language: true } } } }>;

function amountText(payment: Candidate) {
  const value = Number(payment.amount);
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 3 })} ${payment.currency}`;
}

/** "today at 8:00 PM" / "tomorrow at …" / "on Tue, Oct 20 at …" in the payment's own time zone. */
function whenText(payment: Candidate, now: Date, ar: boolean) {
  const locale = ar ? 'ar-EG-u-ca-gregory' : 'en-US-u-ca-gregory';
  const time = new Intl.DateTimeFormat(locale, { timeZone: payment.timezone, hour: 'numeric', minute: '2-digit' }).format(payment.dueAt);
  const today = localDate(now, payment.timezone);
  const due = formatDateOnly(payment.dueDate);
  const tomorrow = localDate(new Date(now.getTime() + 86_400_000), payment.timezone);
  const yesterday = localDate(new Date(now.getTime() - 86_400_000), payment.timezone);
  if (due === today) return ar ? `اليوم الساعة ${time}` : `today at ${time}`;
  if (due === tomorrow) return ar ? `غدًا الساعة ${time}` : `tomorrow at ${time}`;
  if (due === yesterday) return ar ? `أمس الساعة ${time}` : `yesterday at ${time}`;
  const day = new Intl.DateTimeFormat(locale, { timeZone: payment.timezone, weekday: 'short', day: 'numeric', month: 'short' }).format(payment.dueAt);
  return ar ? `يوم ${day} الساعة ${time}` : `on ${day} at ${time}`;
}

function message(kind: DispatchKind, payment: Candidate, now: Date) {
  const ar = payment.family.language === 'ar';
  const when = whenText(payment, now, ar);
  const amount = amountText(payment);
  if (kind === 'REMINDER') {
    return ar
      ? { title: 'تذكير بالدفع', message: `موعد دفع «${payment.name}» بمبلغ ${amount} ${when}.` }
      : { title: 'Payment Reminder', message: `Your ${payment.name} payment of ${amount} is due ${when}.` };
  }
  return ar
    ? { title: '⚠️ دفعة متأخرة', message: `«${payment.name}» بمبلغ ${amount} كان مستحقًا ${when} ولم يُدفع بعد.` }
    : { title: '⚠️ Overdue Payment', message: `${payment.name} (${amount}) was due ${when} and is still unpaid.` };
}

/**
 * Claims the (payment, cycle, kind) slot. The unique index makes this the dedupe point:
 * concurrent runs (cron + on-demand) can never notify twice for the same cycle.
 */
async function claim(payment: Candidate, kind: DispatchKind, scheduledFor: Date) {
  try {
    return await prisma.paymentReminder.create({
      data: { paymentId: payment.id, userId: payment.assigneeId, dueDate: payment.dueDate, kind, scheduledFor },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
    throw error;
  }
}

async function dispatch(kind: DispatchKind, payment: Candidate, scheduledFor: Date, now: Date) {
  const slot = await claim(payment, kind, scheduledFor);
  if (!slot) return false;
  try {
    const text = message(kind, payment, now);
    const push = await notifyUsers([payment.assigneeId], {
      familyId: payment.familyId,
      type: kind === 'REMINDER' ? 'PAYMENT_REMINDER' : 'PAYMENT_OVERDUE',
      relatedEntityId: payment.id,
      ...text,
    });
    // The in-app notification always exists; the push part is best-effort and recorded.
    await prisma.paymentReminder.update({
      where: { id: slot.id },
      data: { status: 'SENT', sentAt: new Date(), error: push.error ?? (push.devices ? null : 'No registered devices') },
    });
  } catch (error) {
    await prisma.paymentReminder.update({
      where: { id: slot.id },
      data: { status: 'FAILED', error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error' },
    });
  }
  return true;
}

/**
 * Sends every reminder and overdue alert that is due now. Safe to run as often as you like and from
 * several places at once (cron, app open). Pass a familyId to limit the run to one family.
 */
export async function processDueNotifications(options: { familyId?: string; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const base: Prisma.PaymentWhereInput = { state: 'ACTIVE', deletedAt: null, ...(options.familyId ? { familyId: options.familyId } : {}) };
  const include = { family: { select: { language: true } } } as const;

  const [reminders, overdue] = await Promise.all([
    prisma.payment.findMany({
      where: { ...base, reminderEnabled: true, reminderAt: { lte: now, gt: new Date(now.getTime() - REMINDER_GRACE_MS) } },
      include,
      take: BATCH,
    }),
    prisma.payment.findMany({
      where: { ...base, dueAt: { lte: new Date(now.getTime() - OVERDUE_DELAY_MS), gt: new Date(now.getTime() - OVERDUE_WINDOW_MS) } },
      include,
      take: BATCH,
    }),
  ]);

  let remindersSent = 0;
  let overdueSent = 0;
  for (const payment of reminders) {
    if (await dispatch('REMINDER', payment, payment.reminderAt!, now)) remindersSent += 1;
  }
  for (const payment of overdue) {
    if (await dispatch('OVERDUE', payment, payment.dueAt, now)) overdueSent += 1;
  }
  return { remindersSent, overdueSent, checkedAt: now.toISOString() };
}
