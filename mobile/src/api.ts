import { Platform } from 'react-native';
import { appVariant } from './appVariant';
import { clearRefreshToken, readRefreshToken, writeRefreshToken } from './session';

/** Accepts "https://host" or "https://host/api"; the API always lives under /api. */
function resolveApiUrl(raw: string) {
  const url = raw.trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/]+$/i.test(url) ? `${url}/api` : url;
}

const API_BASE_URL = resolveApiUrl(
  process.env.EXPO_PUBLIC_API_URL ||
    (Platform.OS === 'web' ? '/api' : Platform.OS === 'android' ? 'http://10.0.2.2:5001/api' : 'http://localhost:5001/api'),
);

export type Role = 'FATHER' | 'MOTHER' | 'CHILD' | 'UNCLE';
/** Every currency the server accepts and has exchange rates for. */
export const CURRENCIES = ['EGP', 'SAR', 'USD', 'EUR', 'AED', 'KWD', 'QAR', 'BHD'] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];
export type PermissionKey =
  | 'VIEW_EXPENSES'
  | 'ADD_EXPENSE'
  | 'EDIT_EXPENSE'
  | 'DELETE_EXPENSE'
  | 'VIEW_PAYMENTS'
  | 'ADD_PAYMENT'
  | 'EDIT_PAYMENT'
  | 'DELETE_PAYMENT'
  | 'VIEW_REPORTS'
  | 'MANAGE_CHILDREN'
  | 'SERVICE_LESSONS'
  | 'SERVICE_RECURRING'
  | 'SERVICE_HOUSEHOLD'
  | 'VIEW_INCOME'
  | 'EVALUATE_CHILDREN'
  | 'MANAGE_CHILD_TASKS'
  | 'PENALIZE_CHILDREN';

export interface Account {
  user: {
    id: string;
    name: string;
    email: string;
    role: Role;
    isAdmin: boolean;
    /** Platform operator: can see every family and enter any of them. */
    isSuperAdmin?: boolean;
    memberId: string | null;
    timezone: string;
    profileImage: string | null;
    permissions: PermissionKey[];
  };
  family: { id: string; name: string; currency: string; timezone: string; ownerId: string };
}

export interface Session extends Account {
  accessToken: string;
  refreshToken: string;
}

export interface Child {
  id: string;
  name: string;
  grade?: string | null;
  school?: string | null;
}

export interface Expense {
  id: string;
  /** In `currency`, as entered. */
  amount: string;
  currency: string;
  /** The same amount in the family currency; add these up for totals. */
  familyAmount: string;
  description: string | null;
  date: string;
  occurredAt: string | null;
  ownerType?: string;
  member: { id: string; name: string } | null;
  category: { key: string | null; nameAr: string; nameEn: string };
  subcategory: { key: string | null; nameAr: string; nameEn: string } | null;
  isRecurring: boolean;
  notes?: string | null;
  createdBy?: { id: string; name: string } | null;
  teacher?: Teacher | null;
  subject?: string | null;
  attachmentCount?: number;
}

export interface Teacher {
  id: string;
  name: string;
  phone: string | null;
  subject: string | null;
  notes?: string | null;
}

/** Pick an existing teacher or create one inline when adding a lesson / fee. */
export type TeacherRef = { teacherId?: string | null; newTeacher?: { name: string; phone?: string | null } };

export interface MonthlyReport {
  month: string;
  currency: string;
  household: { spentAmount: string; plannedRecurringAmount: string; totalAmount: string };
  /** Spending in every other category (food, transport, health, paid bills…). */
  other?: { spentAmount: string };
  /** The whole month: every category, actual + planned recurring. */
  totalAmount?: string;
  homeLessons: {
    spentAmount: string;
    plannedRecurringAmount: string;
    totalAmount: string;
    perChild: {
      childId: string;
      childName: string;
      sessionAmount: string;
      recurringAmount: string;
      totalAmount: string;
    }[];
  };
  expenses: Expense[];
}

interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  code?: string;
  data: T;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function unwrap<T>(response: Response): Promise<T> {
  const envelope = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || !envelope?.success) {
    throw new ApiError(envelope?.message ?? `HTTP ${response.status}`, response.status, envelope?.code);
  }
  return envelope.data;
}

async function publicRequest<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return unwrap<T>(response);
}

/** Super admin sign-in needs a second step: a code from their authenticator app. */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challenge: string;
}

/** `as` is who the user said they are on the login screen; the server checks it against the account. */
export async function signIn(email: string, password: string, as?: 'FATHER' | 'MEMBER') {
  const result = await publicRequest<Session | TwoFactorChallenge>('/auth/login', { email, password, as });
  if ('twoFactorRequired' in result) return result;
  await writeRefreshToken(result.refreshToken);
  return result;
}

/** "Forgot password": emails a reset link or a code (email accounts), or asks the father (username accounts). */
export const requestPasswordReset = (login: string) => publicRequest<{ method: 'link' | 'code' | 'father' }>('/auth/forgot-password', { login });
/** Sets a new password from the emailed reset link's one-time code. */
export const resetPasswordWithLink = (oobCode: string, password: string) => publicRequest<{ email: string }>('/auth/reset-password-link', { oobCode, password });
/** Sets a new password with the emailed 6-digit code. */
export const resetPassword = (login: string, code: string, password: string) => publicRequest<null>('/auth/reset-password', { login, code, password });

export async function completeTwoFactor(challenge: string, code: string) {
  const session = await publicRequest<Session>('/auth/login/2fa', { challenge, code });
  await writeRefreshToken(session.refreshToken);
  return session;
}

export async function register(input: { email: string; password: string; name: string; familyName?: string; inviteCode?: string; timezone?: string }) {
  const session = await publicRequest<Session>('/auth/register', input);
  await writeRefreshToken(session.refreshToken);
  return session;
}

export async function refreshSession(refreshToken: string) {
  const session = await publicRequest<Session>('/auth/refresh', { refreshToken });
  await writeRefreshToken(session.refreshToken);
  return session;
}

export async function restoreSession() {
  const refreshToken = await readRefreshToken();
  if (!refreshToken) return null;
  try {
    return await refreshSession(refreshToken);
  } catch {
    return null;
  }
}

export async function signOut(session: Session) {
  try {
    const refreshToken = await readRefreshToken();
    if (refreshToken) await publicRequest<null>('/auth/logout', { refreshToken });
  } finally {
    await clearRefreshToken();
  }
}

/**
 * The country the app shows (a country id, or 'all'); sent with every request so lists and totals follow
 * it. Null until countries are loaded (the server then shows everything, as for older app versions).
 */
let selectedCountry: string | null = null;
export function setSelectedCountry(country: string | null) {
  selectedCountry = country;
}

export async function authenticatedRequest<T>(
  session: Session,
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  onRefresh: (session: Session) => void,
): Promise<T> {
  const send = (token: string) =>
    fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(selectedCountry ? { 'X-Country': selectedCountry } : {}),
        ...options.headers,
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });

  let response = await send(session.accessToken);
  if (response.status === 401) {
    const refreshToken = (await readRefreshToken()) ?? session.refreshToken;
    const nextSession = await refreshSession(refreshToken);
    onRefresh(nextSession);
    response = await send(nextSession.accessToken);
  }
  return unwrap<T>(response);
}

export async function getChildren(session: Session, onRefresh: (session: Session) => void) {
  return authenticatedRequest<Child[]>(session, '/members/children', {}, onRefresh);
}

export async function addChild(
  session: Session,
  input: { name: string; school?: string; grade?: string },
  onRefresh: (session: Session) => void,
) {
  return authenticatedRequest<Child>(session, '/members/children', { method: 'POST', body: input }, onRefresh);
}

export async function getMonthlyReport(session: Session, month: string, onRefresh: (session: Session) => void) {
  return authenticatedRequest<MonthlyReport>(session, `/reports/monthly?month=${encodeURIComponent(month)}`, {}, onRefresh);
}

/** Reminder created together with an expense: N days before the due date, at `time` (HH:MM). */
export type ReminderOption = { daysBefore: 0 | 1 | 3 | 7; time: string };
export type RecurringFrequency = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'YEARLY';
type WithReminder<T> = T & { reminder: Payment | null };

export async function addHomeLesson(
  session: Session,
  input: { childId: string; amount: string; currency?: string; description?: string; occurredAt: string; reminder?: ReminderOption; subject?: string } & TeacherRef,
  onRefresh: (session: Session) => void,
) {
  return authenticatedRequest<WithReminder<Expense>>(session, '/expenses/home-lessons', { method: 'POST', body: input }, onRefresh);
}

export async function addRecurringTuition(
  session: Session,
  input: { childId: string; amount: string; currency?: string; description: string; frequency: RecurringFrequency; startDate: string; dueTime: string; reminder?: ReminderOption; subject?: string } & TeacherRef,
  onRefresh: (session: Session) => void,
) {
  return authenticatedRequest<WithReminder<RecurringFee>>(session, '/expenses/recurring-home-lessons', { method: 'POST', body: input }, onRefresh);
}

export async function addHouseholdExpense(
  session: Session,
  input: { amount: string; currency?: string; subcategoryKey?: string; description?: string; occurredAt: string; reminder?: ReminderOption },
  onRefresh: (session: Session) => void,
) {
  return authenticatedRequest<WithReminder<Expense>>(session, '/expenses/household', { method: 'POST', body: input }, onRefresh);
}

export async function addRecurringHousehold(
  session: Session,
  input: { amount: string; currency?: string; subcategoryKey?: string; description: string; frequency: RecurringFrequency; startDate: string; dueTime: string; reminder?: ReminderOption },
  onRefresh: (session: Session) => void,
) {
  return authenticatedRequest<WithReminder<RecurringFee>>(session, '/expenses/recurring-household', { method: 'POST', body: input }, onRefresh);
}

export function apiBaseUrl() {
  return API_BASE_URL;
}
export async function getExpense(session: Session, id: string, onRefresh: (session: Session) => void) {
  return authenticatedRequest<Expense>(session, `/expenses/${encodeURIComponent(id)}`, {}, onRefresh);
}

export async function deleteExpense(session: Session, id: string, onRefresh: (session: Session) => void) {
  return authenticatedRequest<null>(session, `/expenses/${encodeURIComponent(id)}`, { method: 'DELETE' }, onRefresh);
}

export interface RecurringFee {
  id: string;
  amount: string;
  currency: string;
  /** In the family currency; add these up for totals. */
  familyAmount: string;
  description: string;
  frequency: string;
  startDate: string;
  child: { id: string; name: string } | null;
  kind?: 'LESSON' | 'HOUSEHOLD';
  section?: { key: string | null; nameAr: string; nameEn: string } | null;
  teacher?: Teacher | null;
  subject?: string | null;
}

export interface ChildDetails {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  dateOfBirth: string | null;
  /** Currency of the lessons' and fees' familyAmount (the selected country's); missing on older servers. */
  currency?: CurrencyCode;
  lessons: Expense[];
  recurring: RecurringFee[];
}

export interface HouseholdSection {
  id: string;
  key: string | null;
  nameAr: string;
  nameEn: string;
}

export async function getChildDetails(session: Session, id: string, onRefresh: (session: Session) => void) {
  return authenticatedRequest<ChildDetails>(session, `/members/children/${encodeURIComponent(id)}`, {}, onRefresh);
}

export async function deleteChild(session: Session, id: string, onRefresh: (session: Session) => void) {
  return authenticatedRequest<null>(session, `/members/children/${encodeURIComponent(id)}`, { method: 'DELETE' }, onRefresh);
}

export async function getRecurringFees(session: Session, onRefresh: (session: Session) => void) {
  return authenticatedRequest<RecurringFee[]>(session, '/recurring', {}, onRefresh);
}

export async function deleteRecurringFee(session: Session, id: string, onRefresh: (session: Session) => void) {
  return authenticatedRequest<null>(session, `/recurring/${encodeURIComponent(id)}`, { method: 'DELETE' }, onRefresh);
}

export async function getHouseholdSections(session: Session, onRefresh: (session: Session) => void) {
  return authenticatedRequest<HouseholdSection[]>(session, '/household-sections', {}, onRefresh);
}

export async function addHouseholdSection(session: Session, name: string, onRefresh: (session: Session) => void) {
  return authenticatedRequest<HouseholdSection>(session, '/household-sections', { method: 'POST', body: { name } }, onRefresh);
}

export async function renameHouseholdSection(session: Session, id: string, name: string, onRefresh: (session: Session) => void) {
  return authenticatedRequest<HouseholdSection>(session, `/household-sections/${encodeURIComponent(id)}`, { method: 'PUT', body: { name } }, onRefresh);
}

export async function deleteHouseholdSection(session: Session, id: string, onRefresh: (session: Session) => void) {
  return authenticatedRequest<null>(session, `/household-sections/${encodeURIComponent(id)}`, { method: 'DELETE' }, onRefresh);
}

export interface ExchangeRates {
  base: string;
  rates: Record<string, number>;
  updatedAt: string;
  source: string;
}

export async function getExchangeRates() {
  return unwrap<ExchangeRates>(await fetch(`${API_BASE_URL}/rates`));
}

// ───────────── Account & family ─────────────

async function call<T>(session: Session, path: string, onRefresh: (session: Session) => void, method = 'GET', body?: unknown) {
  return authenticatedRequest<T>(session, path, { method, body }, onRefresh);
}

const enc = encodeURIComponent;

export async function getAccount(session: Session, onRefresh: (session: Session) => void) {
  return call<Account>(session, '/auth/me', onRefresh);
}

export async function updateProfile(session: Session, input: { name?: string; timezone?: string }, onRefresh: (session: Session) => void) {
  return call<Account>(session, '/auth/me', onRefresh, 'PUT', input);
}

export interface InvitationPreview {
  familyName: string;
  invitedBy: string;
  role: Role;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
  emailHint: string;
  expiresAt: string;
}

export async function previewInvitation(code: string) {
  return unwrap<InvitationPreview>(await fetch(`${API_BASE_URL}/invitations/${enc(code.trim())}`));
}

export async function rejectInvitation(code: string) {
  return publicRequest<null>(`/invitations/${enc(code.trim())}/reject`, {});
}

export interface FamilyMember {
  id: string;
  name: string;
  role: Role;
  isOwner: boolean;
  isAdmin: boolean;
  child: { id: string; name: string } | null;
  email?: string;
  timezone?: string;
  permissions?: PermissionKey[];
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  memberId: string | null;
  code: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
}

export interface PermissionMatrix {
  catalog: { key: PermissionKey; label: string }[];
  members: { userId: string; name: string; role: Role; editable: boolean; permissions: Record<PermissionKey, boolean> }[];
}

export const getMembers = (s: Session, r: (s: Session) => void) => call<FamilyMember[]>(s, `/families/${enc(s.family.id)}/members`, r);
export const removeMember = (s: Session, userId: string, r: (s: Session) => void) => call<null>(s, `/families/${enc(s.family.id)}/members/${enc(userId)}`, r, 'DELETE');
export const changeRole = (s: Session, userId: string, role: Role, memberId: string | undefined, r: (s: Session) => void) =>
  call<FamilyMember>(s, `/families/${enc(s.family.id)}/members/${enc(userId)}/role`, r, 'PUT', { role, memberId });
export const createMemberAccount = (s: Session, input: { name: string; login: string; password: string; role: Role; memberId?: string }, r: (s: Session) => void) =>
  call<FamilyMember>(s, `/families/${enc(s.family.id)}/members`, r, 'POST', input);
export const resetMemberPassword = (s: Session, userId: string, password: string, r: (s: Session) => void) =>
  call<null>(s, `/families/${enc(s.family.id)}/members/${enc(userId)}/password`, r, 'PUT', { password });
export const getInvitations = (s: Session, r: (s: Session) => void) => call<Invitation[]>(s, `/families/${enc(s.family.id)}/invitations`, r);
export const createInvitation = (s: Session, input: { email: string; role: Role; memberId?: string }, r: (s: Session) => void) =>
  call<Invitation>(s, `/families/${enc(s.family.id)}/invitations`, r, 'POST', input);
export const revokeInvitation = (s: Session, id: string, r: (s: Session) => void) => call<null>(s, `/families/${enc(s.family.id)}/invitations/${enc(id)}`, r, 'DELETE');
export const getPermissionMatrix = (s: Session, r: (s: Session) => void) => call<PermissionMatrix>(s, `/families/${enc(s.family.id)}/permissions`, r);
export const setMemberPermissions = (s: Session, userId: string, permissions: Partial<Record<PermissionKey, boolean>>, r: (s: Session) => void) =>
  call<PermissionMatrix['members'][number]>(s, `/families/${enc(s.family.id)}/members/${enc(userId)}/permissions`, r, 'PUT', { permissions });

// ───────────── Expenses (edit) & income ─────────────

export interface ExpenseUpdate extends TeacherRef {
  amount?: string;
  currency?: string;
  description?: string;
  notes?: string | null;
  occurredAt?: string;
  /** Lessons only: move the lesson to another child. */
  childId?: string;
  subject?: string | null;
}
export const updateExpense = (s: Session, id: string, input: ExpenseUpdate, r: (s: Session) => void) =>
  call<Expense>(s, `/expenses/${enc(id)}`, r, 'PUT', input);

export const addIncome = (s: Session, input: { amount: string; source: string; date: string; currency?: string; description?: string }, r: (s: Session) => void) =>
  call<{ id: string }>(s, '/incomes', r, 'POST', input);
export const deleteIncome = (s: Session, id: string, r: (s: Session) => void) => call<null>(s, `/incomes/${enc(id)}`, r, 'DELETE');

export interface IncomeSummary {
  month: string;
  currency: string;
  salary: { id: string; amount: string; currency: string; amountInFamilyCurrency: string; description: string | null; payDay: number; since: string } | null;
  totals: { salary: string; extraIncome: string; income: string; expenses: string; household: string; lessons: string; other?: string; savedToVault?: string | null; remaining: string; spentRatio: number | null };
  incomes: { id: string; amount: string; currency: string; amountInFamilyCurrency: string; source: string; description: string | null; date: string; createdBy: { id: string; name: string } | null }[];
}

export const getIncomeSummary = (s: Session, month: string, r: (s: Session) => void) => call<IncomeSummary>(s, `/incomes/summary?month=${enc(month)}`, r);
export const setSalary = (s: Session, input: { amount: string; payDay: number; currency?: string; description?: string }, r: (s: Session) => void) =>
  call<IncomeSummary>(s, '/incomes/salary', r, 'PUT', input);
export const removeSalary = (s: Session, r: (s: Session) => void) => call<null>(s, '/incomes/salary', r, 'DELETE');

// ───────────── Payments ─────────────

export type PaymentCategory = 'BILL' | 'TUITION' | 'COURSE' | 'SUBSCRIPTION' | 'RENT' | 'INTERNET' | 'MOBILE' | 'INSURANCE' | 'INSTALLMENT' | 'LOAN' | 'OTHER';
export type PaymentFrequency = 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'YEARLY' | 'CUSTOM';
export type PaymentStatus = 'UPCOMING' | 'DUE_SOON' | 'DUE_TODAY' | 'OVERDUE' | 'PAID' | 'CANCELLED';

export interface Payment {
  id: string;
  name: string;
  /** The country it belongs to; missing on older servers. */
  countryId?: string | null;
  /** Lesson subject key, shown next to the name. */
  subject: string | null;
  /** The family's name for the subject when added or renamed; null = built-in name. */
  subjectName: string | null;
  description: string | null;
  notes: string | null;
  amount: string;
  currency: string;
  category: PaymentCategory;
  frequency: PaymentFrequency;
  customIntervalDays: number | null;
  isRecurring: boolean;
  startDate: string;
  dueDate: string;
  dueTime: string;
  timezone: string;
  dueAt: string;
  nextDueDate: string | null;
  state: 'ACTIVE' | 'PAID' | 'CANCELLED';
  status: PaymentStatus;
  reminderEnabled: boolean;
  reminderDaysBefore: number | null;
  reminderTime: string | null;
  reminderAt: string | null;
  lastPaidAt: string | null;
  lastPaidBy: { id: string; name: string } | null;
  createdBy: { id: string; name: string };
  assignee: { id: string; name: string };
  member: { id: string; name: string } | null;
  teacher: Teacher | null;
  /** Lessons paid together; the amount is their sum. Empty for a plain payment. */
  items: PaymentItem[];
  createdAt: string;
}

/** One lesson inside a payment. */
export interface PaymentItem {
  id?: string;
  subject: string | null;
  /** YYYY-MM-DD */
  date: string | null;
  amount: string;
  note?: string | null;
}

export interface PaymentDetails extends Payment {
  history: {
    id: string;
    dueDate: string;
    amount: string;
    paidAt: string;
    paidBy: { id: string; name: string } | null;
    receiptIds: string[];
    /** What the receipt check found when it was paid; null for older payments. */
    receiptCheck: ReceiptCheckStatus | null;
    receiptAmount: string | null;
    receiptCurrency: string | null;
    overridden: boolean;
    receiptChecks: { amount: CheckResult; date: CheckResult; recipient: CheckResult } | null;
    status: 'PAID';
  }[];
}

export type ReceiptCheckStatus = 'MATCH' | 'MISMATCH' | 'UNREADABLE' | 'DUPLICATE' | 'UNAVAILABLE';

/** What the server read from a payment screenshot, compared with the payment. */
export type CheckResult = 'ok' | 'bad' | 'unknown' | 'skipped';
export interface ReceiptCheck {
  status: ReceiptCheckStatus;
  reason: 'NOT_A_RECEIPT' | 'AMOUNT_NOT_FOUND' | 'AMOUNT_DIFFERS' | 'TRANSFER_FAILED' | 'DATE_OUT_OF_RANGE' | 'WRONG_RECIPIENT' | 'DUPLICATE' | 'SCAN_FAILED' | null;
  checks: { amount: CheckResult; date: CheckResult; recipient: CheckResult };
  amount: string | null;
  currency: string | null;
  transferDate: string | null;
  recipientNumber: string | null;
  recipientName: string | null;
  expectedAmount: string;
  expectedCurrency: string;
  /** "YYYY-MM": the transfer must be in the due date's month. */
  expectedMonth: string;
  /** Set for lesson payments: the money must go to this teacher. */
  teacher: { name: string; phone: string | null } | null;
  /** Confirming is blocked unless the father overrides. */
  blocked: boolean;
  canOverride: boolean;
  usedFor: { name: string; paidAt: string } | null;
}

export interface PaymentInput extends TeacherRef {
  name: string;
  description?: string | null;
  notes?: string | null;
  amount: string;
  currency?: string;
  category: PaymentCategory;
  frequency: PaymentFrequency;
  customIntervalDays?: number | null;
  startDate?: string;
  dueDate: string;
  dueTime: string;
  assigneeId?: string;
  memberId?: string | null;
  reminderEnabled: boolean;
  reminderDaysBefore?: number | null;
  reminderTime?: string | null;
  reminderAt?: string | null;
  /** Lessons paid together; the server sets the amount to their sum. [] removes them. */
  items?: PaymentItem[];
}

export const getPayments = (s: Session, r: (s: Session) => void, status?: PaymentStatus | 'OPEN') =>
  call<Payment[]>(s, `/payments${status ? `?status=${status}` : ''}`, r);
/** Payments of every country, whatever country the app shows (the payments page filters them itself). */
export const getAllCountriesPayments = (s: Session, r: (s: Session) => void) =>
  authenticatedRequest<Payment[]>(s, '/payments', { headers: { 'X-Country': 'all' } }, r);
/** Payment totals in the family currency, from the server (real payment history). */
export interface PaymentTotals {
  currency: string;
  /** All payments (paid + still to pay), each counted once. */
  total: string;
  totalCount: number;
  /** Payments that show as paid (one-time paid, or a recurring bill whose last cycle is paid). */
  paid: string;
  paidCount: number;
  toPay: string;
  toPayCount: number;
  overdue: string;
  overdueCount: number;
  dueToday: string;
  next7Days: string;
  paidThisMonth: string;
  paidThisMonthCount: number;
  unconvertedCount: number;
}
/** Everything due in one month (paid or not), in the family currency. */
export interface MonthPayments {
  month: string;
  currency: string;
  total: string;
  paid: string;
  paidCount: number;
  remaining: string;
  remainingCount: number;
  overdue: string;
  unconvertedCount: number;
}
export const getMonthPayments = (s: Session, month: string, r: (s: Session) => void) => call<MonthPayments>(s, `/payments/month?month=${enc(month)}`, r);
export const getPaymentTotals = (s: Session, r: (s: Session) => void) => call<PaymentTotals>(s, '/payments/summary', r);
export const getPayment = (s: Session, id: string, r: (s: Session) => void) => call<PaymentDetails>(s, `/payments/${enc(id)}`, r);
export const createPayment = (s: Session, input: PaymentInput, r: (s: Session) => void) => call<Payment>(s, '/payments', r, 'POST', input);
export const updatePayment = (s: Session, id: string, input: Partial<PaymentInput>, r: (s: Session) => void) => call<Payment>(s, `/payments/${enc(id)}`, r, 'PUT', input);
export const deletePayment = (s: Session, id: string, r: (s: Session) => void) => call<null>(s, `/payments/${enc(id)}`, r, 'DELETE');
/** A screenshot of the transfer / photo of the receipt; required to mark a payment paid. */
export type ReceiptImage = { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string; width?: number; height?: number };
export const checkPaymentReceipt = (s: Session, id: string, receipt: ReceiptImage, r: (s: Session) => void) =>
  call<ReceiptCheck>(s, `/payments/${enc(id)}/check-receipt`, r, 'POST', { receipt });
export const payPayment = (s: Session, id: string, receipt: ReceiptImage, r: (s: Session) => void, override = false) =>
  call<Payment & { paidCycle: { dueDate: string; paidAt: string }; receiptCheck: ReceiptCheckStatus }>(s, `/payments/${enc(id)}/pay`, r, 'POST', { receipt, ...(override ? { override } : {}) });
export const unpayPayment = (s: Session, id: string, r: (s: Session) => void) => call<Payment>(s, `/payments/${enc(id)}/unpay`, r, 'POST');
export const cancelPayment = (s: Session, id: string, r: (s: Session) => void) => call<Payment>(s, `/payments/${enc(id)}/cancel`, r, 'POST');

// ───────────── Notifications ─────────────

export type NotificationType = 'PAYMENT_REMINDER' | 'PAYMENT_OVERDUE' | 'INVITATION' | 'PERMISSION_CHANGE' | 'FAMILY_EVENT' | 'PASSWORD_RESET_REQUEST' | 'CHILD_POINTS' | 'PAYMENT_RECEIPT' | 'EXPENSE_RECEIPT';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  relatedEntityId: string | null;
  url: string;
  isRead: boolean;
  createdAt: string;
}

export const getNotifications = (s: Session, r: (s: Session) => void) => call<{ items: AppNotification[]; unreadCount: number }>(s, `/notifications?app=${appVariant()}`, r);
export const markNotificationRead = (s: Session, id: string, r: (s: Session) => void) => call<null>(s, `/notifications/${enc(id)}/read`, r, 'PUT');
export const markAllNotificationsRead = (s: Session, r: (s: Session) => void) => call<{ updated: number }>(s, `/notifications/read-all?app=${appVariant()}`, r, 'PUT');
export const deleteNotification = (s: Session, id: string, r: (s: Session) => void) => call<null>(s, `/notifications/${enc(id)}`, r, 'DELETE');
export const registerPushToken = (s: Session, token: string, platform: string, r: (s: Session) => void) => call<null>(s, '/push-tokens', r, 'POST', { token, platform, app: appVariant() });
export const unregisterPushToken = (s: Session, token: string, r: (s: Session) => void) => call<null>(s, '/push-tokens', r, 'DELETE', { token });

// ───────────── Dashboard ─────────────

export interface Dashboard {
  month: string;
  currency: string;
  totals: {
    income: string | null;
    salary: string | null;
    expenses: string;
    balance: string | null;
    spentRatio: number | null;
    hasSalary: boolean;
    planned?: string;
    lessons?: string;
    lessonsPlanned?: string;
    savedToVault?: string | null;
    /** Due this month and not in the spending yet (null without payment access). */
    stillToPay: string | null;
    /** Remaining salary once that is paid (null without salary or payment access). */
    afterPaying: string | null;
  };
  payments: { today: string; overdue: Payment[]; dueToday: Payment[]; upcoming: Payment[] };
  recentExpenses: Expense[];
  members: FamilyMember[];
  unreadNotifications: number;
}

export const getDashboard = (s: Session, month: string, r: (s: Session) => void) => call<Dashboard>(s, `/dashboard?month=${enc(month)}`, r);

// ───────────── Teachers ─────────────

export const getTeachers = (s: Session, r: (s: Session) => void) => call<Teacher[]>(s, '/teachers', r);

/** A teacher's page: contact, their lessons, recurring fees and the payments that go to them. */
export interface TeacherProfile extends Teacher {
  removed: boolean;
  currency: string;
  lessonsCount: number;
  /** Everything recorded for their lessons, in the family currency. */
  lessonsTotal: string;
  lessons: { id: string; amount: string; currency: string; familyAmount: string; description: string | null; subject: string | null; date: string; child: { id: string; name: string } | null }[];
  fees: { id: string; amount: string; currency: string; description: string; frequency: string; subject: string | null; child: { id: string; name: string } | null }[];
  payments: Payment[];
}
export const getTeacherProfile = (s: Session, id: string, r: (s: Session) => void) => call<TeacherProfile>(s, `/teachers/${enc(id)}`, r);
export const addTeacher = (s: Session, input: { name: string; phone?: string | null; subject?: string | null }, r: (s: Session) => void) =>
  call<Teacher>(s, '/teachers', r, 'POST', input);
export const updateTeacher = (s: Session, id: string, input: { name?: string; phone?: string | null; subject?: string | null }, r: (s: Session) => void) =>
  call<Teacher>(s, `/teachers/${enc(id)}`, r, 'PUT', input);
export const getUsedSubjects = (s: Session, r: (s: Session) => void) => call<string[]>(s, '/teachers/subjects', r);

/** A lesson subject in the family's list. `name` null = the built-in subject's translated name. */
export interface Subject {
  id: string;
  key: string;
  name: string | null;
  builtin: boolean;
  isActive: boolean;
}
export const getSubjects = (s: Session, r: (s: Session) => void) => call<Subject[]>(s, '/subjects', r);
export const createSubject = (s: Session, name: string, r: (s: Session) => void) => call<Subject>(s, '/subjects', r, 'POST', { name });
export const updateSubject = (s: Session, id: string, input: { name?: string; isActive?: boolean }, r: (s: Session) => void) => call<Subject>(s, `/subjects/${enc(id)}`, r, 'PUT', input);
export const deleteSubject = (s: Session, id: string, r: (s: Session) => void) => call<null>(s, `/subjects/${enc(id)}`, r, 'DELETE');
export const deleteTeacher = (s: Session, id: string, r: (s: Session) => void) => call<null>(s, `/teachers/${enc(id)}`, r, 'DELETE');

// ───────────── Attachments (payment screenshots, receipts) ─────────────

export type AttachmentTarget = { expenseId: string } | { paymentId: string } | { paymentRecordId: string };

export interface AttachmentMeta {
  id: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  uploadedBy: { id: string; name: string } | null;
  cycleDueDate: string | null;
  canDelete: boolean;
}

export const getAttachments = (s: Session, target: AttachmentTarget, r: (s: Session) => void) => {
  const [key, value] = Object.entries(target)[0];
  return call<AttachmentMeta[]>(s, `/attachments?${key}=${enc(value)}`, r);
};
/** A 10-minute link that opens the image in the browser so it can be saved (relative to the API base). */
export const createAttachmentDownloadLink = (s: Session, id: string, r: (s: Session) => void) =>
  call<{ path: string; expiresInSeconds: number }>(s, `/attachments/${enc(id)}/download-link`, r, 'POST');
export const getAttachmentImage = (s: Session, id: string, r: (s: Session) => void) =>
  call<{ id: string; mimeType: string; width: number | null; height: number | null; data: string }>(s, `/attachments/${enc(id)}`, r);
export const uploadAttachment = (
  s: Session,
  input: AttachmentTarget & { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string; width?: number; height?: number },
  r: (s: Session) => void,
) => call<AttachmentMeta>(s, '/attachments', r, 'POST', input);
export const deleteAttachment = (s: Session, id: string, r: (s: Session) => void) => call<null>(s, `/attachments/${enc(id)}`, r, 'DELETE');

// ───────────── Father's private money (visible only to its owner) ─────────────

export interface PrivateSummary {
  month: string;
  currency: string;
  balance: string;
  monthIn: string;
  monthOut: string;
  entries: { id: string; direction: 'IN' | 'OUT'; amount: string; note: string | null; date: string }[];
}

export const getPrivateMoney = (s: Session, month: string, r: (s: Session) => void) => call<PrivateSummary>(s, `/private?month=${enc(month)}`, r);
export const addPrivateEntry = (s: Session, input: { direction: 'IN' | 'OUT'; amount: string; note?: string; date?: string }, r: (s: Session) => void) =>
  call<PrivateSummary>(s, '/private', r, 'POST', input);
export const deletePrivateEntry = (s: Session, id: string, r: (s: Session) => void) => call<null>(s, `/private/${enc(id)}`, r, 'DELETE');


// ─────────────── Super admin ───────────────

export interface AdminFamily {
  id: string;
  name: string;
  currency: string;
  createdAt: string;
  isCurrent: boolean;
  owner: { id: string; name: string; email: string };
  counts: { users: number; children: number; expenses: number; payments: number };
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  isSuperAdmin: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  family: { id: string; name: string } | null;
}

export const getAdminFamilies = (s: Session, r: (s: Session) => void) => call<AdminFamily[]>(s, '/admin/families', r);
export const getAdminUsers = (s: Session, r: (s: Session) => void) => call<AdminUser[]>(s, '/admin/users', r);
export const updateAdminUser = (s: Session, id: string, input: { name?: string; email?: string; password?: string; isActive?: boolean }, r: (s: Session) => void) =>
  call<AdminUser>(s, `/admin/users/${enc(id)}`, r, 'PUT', input);
export const deleteAdminUser = (s: Session, id: string, r: (s: Session) => void) => call<{ deletedFamily: string | null }>(s, `/admin/users/${enc(id)}`, r, 'DELETE');

/** Enters another family as its admin. Returns a new session; the old one is revoked by the server. */
export async function switchFamily(s: Session, familyId: string, r: (s: Session) => void) {
  const refreshToken = (await readRefreshToken()) ?? s.refreshToken;
  const next = await call<Session>(s, '/admin/switch-family', r, 'POST', { familyId, refreshToken });
  await writeRefreshToken(next.refreshToken);
  return next;
}

// ───────────── Allowances (عهدة) ─────────────

export interface Wallet {
  id: string;
  name: string;
  currency: string;
  holder: { id: string; name: string };
  spenders: { id: string; name: string }[];
  added: string;
  spent: string;
  balance: string;
  canSpend: boolean;
  canManage: boolean;
  createdAt: string;
}

export interface WalletDetails extends Wallet {
  entries: { id: string; type: 'TOPUP' | 'SPEND'; amount: string; note: string | null; date: string; createdBy: { id: string; name: string } | null; createdAt: string; canDelete: boolean }[];
}

export const getWallets = (s: Session, r: (s: Session) => void) => call<Wallet[]>(s, '/wallets', r);
export const getWallet = (s: Session, id: string, r: (s: Session) => void) => call<WalletDetails>(s, `/wallets/${enc(id)}`, r);
export const createWallet = (s: Session, input: { name: string; holderId: string; amount?: string; spenderIds?: string[] }, r: (s: Session) => void) =>
  call<WalletDetails>(s, '/wallets', r, 'POST', input);
export const updateWallet = (s: Session, id: string, input: { name?: string; holderId?: string; spenderIds?: string[] }, r: (s: Session) => void) =>
  call<WalletDetails>(s, `/wallets/${enc(id)}`, r, 'PUT', input);
export const closeWallet = (s: Session, id: string, r: (s: Session) => void) => call<null>(s, `/wallets/${enc(id)}`, r, 'DELETE');
export const topUpWallet = (s: Session, id: string, input: { amount: string; note?: string }, r: (s: Session) => void) =>
  call<WalletDetails>(s, `/wallets/${enc(id)}/topup`, r, 'POST', input);
export const spendFromWallet = (s: Session, id: string, input: { amount: string; note?: string; sectionKey?: string }, r: (s: Session) => void) =>
  call<WalletDetails>(s, `/wallets/${enc(id)}/spend`, r, 'POST', input);
export const deleteWalletEntry = (s: Session, id: string, entryId: string, r: (s: Session) => void) =>
  call<WalletDetails>(s, `/wallets/${enc(id)}/entries/${enc(entryId)}`, r, 'DELETE');

// ───────────── Children's points, tasks & rewards ─────────────

export type PointRuleKind = 'BEHAVIOR' | 'PENALTY' | 'REWARD';
export type PointEntryKind = 'AWARD' | 'TASK' | 'PENALTY' | 'REWARD' | 'CONVERT' | 'PAYOUT' | 'ALLOWANCE';
export type ChildTaskStatus = 'PENDING' | 'COMPLETED' | 'APPROVED' | 'MISSED';
type Person = { id: string; name: string } | null;

export interface PointRule {
  id: string;
  kind: PointRuleKind;
  name: string;
  points: number;
  isActive: boolean;
}

export interface RewardSettings {
  pointValue: string;
  maxAwardPoints: number;
  maxPenaltyPoints: number;
  dailyPenaltyLimit: number;
  maxPenaltyAmount: string;
  allowNegativePoints: boolean;
  currency: string;
}

export interface KidSummary {
  id: string;
  name: string;
  grade: string | null;
  school: string | null;
  points: number;
  money: string;
  currency: string;
  stars: number | null;
  pendingTasks: number;
  awaitingApproval: number;
}

export interface PointEntry {
  id: string;
  kind: PointEntryKind;
  points: number;
  /** Signed change to the reward money balance. */
  amount: string;
  /** Money handed to the child (payout / allowance). */
  cash: string | null;
  reason: string;
  rule: { id: string; name: string } | null;
  task: { id: string; title: string } | null;
  date: string;
  createdAt: string;
  createdBy: Person;
  voided: boolean;
  voidedAt: string | null;
  voidedBy: Person;
  voidReason: string | null;
  canVoid: boolean;
}

export interface ChildTask {
  id: string;
  /** A day's copy of a daily task. */
  daily: boolean;
  dailyTaskId: string | null;
  forDate: string | null;
  title: string;
  description: string | null;
  dueDate: string | null;
  points: number;
  status: ChildTaskStatus;
  overdue: boolean;
  createdBy: Person;
  completedAt: string | null;
  completedBy: Person;
  reviewedAt: string | null;
  reviewedBy: Person;
  reviewNote: string | null;
  createdAt: string;
  canComplete: boolean;
  canApprove: boolean;
  canReturn: boolean;
  canEdit: boolean;
  /** Any task can be deleted by a parent who manages tasks (an approved one gives its points back). */
  canDelete: boolean;
}

/** A task that repeats on chosen weekdays (0 = Sunday … 6 = Saturday). */
export interface DailyTask {
  id: string;
  title: string;
  description: string | null;
  points: number;
  weekdays: number[];
  isActive: boolean;
}

/** Points earned / lost on one day and how many of that day's daily tasks were done. */
export interface DaySummary {
  date: string;
  earned: number;
  lost: number;
  net: number;
  dailyTotal: number;
  dailyDone: number;
  dailyApproved: number;
}

export interface KidDay extends DaySummary {
  child: { id: string; name: string };
  currency: string;
  isToday: boolean;
  dailyTasks: ChildTask[];
  otherTasks: ChildTask[];
  entries: PointEntry[];
}

export type AchievementKey = 'first_task' | 'tasks_10' | 'points_100' | 'points_500' | 'clean_week' | 'first_reward';

export interface KidBoard {
  child: { id: string; name: string; grade: string | null; school: string | null };
  currency: string;
  points: number;
  money: string;
  moneyValueOfPoints: string;
  stars: number | null;
  level: number;
  progress: number;
  size: number;
  lifetimeEarned: number;
  approvedTasks: number;
  achievements: { key: AchievementKey; earned: boolean }[];
  weeks: { start: string; end: string; earned: number; lost: number }[];
  today: DaySummary;
  dailyTasks: DailyTask[];
  tasks: ChildTask[];
  entries: PointEntry[];
  rules: PointRule[];
  settings: RewardSettings;
  can: { award: boolean; penalize: boolean; manageTasks: boolean; manageMoney: boolean; configure: boolean };
}

export interface KidReport {
  child: { id: string; name: string };
  period: 'week' | 'month';
  start: string;
  end: string;
  currency: string;
  points: { behavior: number; tasks: number; penalties: number; rewards: number; converted: number; net: number };
  money: { converted: string; rewardsPaid: string; allowances: string; penalties: string };
  counts: { awards: number; penalties: number; rewards: number; tasksApproved: number; tasksCreated: number; tasksCompleted: number; tasksOverdue: number; dailyMissed: number };
  stars: number | null;
  days: { date: string; earned: number; lost: number }[];
  entries: PointEntry[];
}

export interface KidSettings {
  settings: RewardSettings;
  rules: PointRule[];
  canConfigure: boolean;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: Person;
  child: Person;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export type TaskInput = { title: string; description?: string | null; dueDate?: string | null; points: number };
type R = (s: Session) => void;
const kid = (id: string) => `/kids/${enc(id)}`;

export const getKids = (s: Session, r: R) => call<KidSummary[]>(s, '/kids', r);
export const getKidBoard = (s: Session, id: string, r: R) => call<KidBoard>(s, kid(id), r);
export const getKidReport = (s: Session, id: string, period: 'week' | 'month', date: string, r: R) =>
  call<KidReport>(s, `${kid(id)}/report?period=${period}&date=${enc(date)}`, r);
export const awardPoints = (s: Session, id: string, input: { ruleId?: string; points?: number; reason?: string }, r: R) => call<KidBoard>(s, `${kid(id)}/points`, r, 'POST', input);
export const penalizeKid = (s: Session, id: string, input: { ruleId?: string; points?: number; amount?: string; reason?: string }, r: R) =>
  call<KidBoard>(s, `${kid(id)}/penalties`, r, 'POST', input);
export const redeemReward = (s: Session, id: string, ruleId: string, r: R) => call<KidBoard>(s, `${kid(id)}/rewards`, r, 'POST', { ruleId });
export const convertPoints = (s: Session, id: string, points: number, r: R) => call<KidBoard>(s, `${kid(id)}/convert`, r, 'POST', { points });
export const payKid = (s: Session, id: string, kind: 'payouts' | 'allowances', input: { amount: string; note?: string }, r: R) => call<KidBoard>(s, `${kid(id)}/${kind}`, r, 'POST', input);
export const voidPointEntry = (s: Session, entryId: string, reason: string | undefined, r: R) => call<KidBoard>(s, `/kids/entries/${enc(entryId)}/void`, r, 'POST', { reason });
export const createKidTask = (s: Session, id: string, input: TaskInput, r: R) => call<KidBoard>(s, `${kid(id)}/tasks`, r, 'POST', input);
export const updateKidTask = (s: Session, taskId: string, input: Partial<TaskInput>, r: R) => call<KidBoard>(s, `/kids/tasks/${enc(taskId)}`, r, 'PUT', input);
export const deleteKidTask = (s: Session, taskId: string, r: R) => call<KidBoard>(s, `/kids/tasks/${enc(taskId)}`, r, 'DELETE');
export const kidTaskAction = (s: Session, taskId: string, action: 'complete' | 'approve' | 'return', note: string | undefined, r: R) =>
  call<KidBoard>(s, `/kids/tasks/${enc(taskId)}/${action}`, r, 'POST', action === 'return' ? { note } : {});
export type DailyInput = { title: string; description?: string | null; points: number; weekdays: number[] };
export const getKidDay = (s: Session, id: string, date: string | undefined, r: R) => call<KidDay>(s, `${kid(id)}/day${date ? `?date=${enc(date)}` : ''}`, r);
export const createDailyTask = (s: Session, id: string, input: DailyInput, r: R) => call<KidBoard>(s, `${kid(id)}/daily`, r, 'POST', input);
export const updateDailyTask = (s: Session, dailyId: string, input: Partial<DailyInput> & { isActive?: boolean }, r: R) => call<KidBoard>(s, `/kids/daily/${enc(dailyId)}`, r, 'PUT', input);
export const stopDailyTask = (s: Session, dailyId: string, r: R) => call<KidBoard>(s, `/kids/daily/${enc(dailyId)}`, r, 'DELETE');
export const getKidSettings = (s: Session, r: R) => call<KidSettings>(s, '/kids/settings', r);
export const updateKidSettings = (s: Session, input: Partial<Omit<RewardSettings, 'currency'>>, r: R) => call<KidSettings>(s, '/kids/settings', r, 'PUT', input);
export const createPointRule = (s: Session, input: { kind: PointRuleKind; name: string; points: number }, r: R) => call<KidSettings>(s, '/kids/rules', r, 'POST', input);
export const updatePointRule = (s: Session, id: string, input: { name?: string; points?: number; isActive?: boolean }, r: R) => call<KidSettings>(s, `/kids/rules/${enc(id)}`, r, 'PUT', input);
export const getKidAudit = (s: Session, childId: string | undefined, r: R) => call<AuditEntry[]>(s, `/kids/audit${childId ? `?childId=${enc(childId)}` : ''}`, r);

// ───────────── Dashboard & analytics ─────────────

export type InsightsPeriod = 'today' | 'week' | 'month' | 'custom';
type Amount = { amount: string; count: number };
export interface Insights {
  period: InsightsPeriod;
  range: { from: string; to: string };
  currency: string;
  /** Spending buckets are days, or months for ranges over ~2 months. */
  unit: 'day' | 'month';
  totals: {
    expenses: string;
    lessons: string | null;
    paid: Amount;
    unpaid: Amount;
    overdue: Amount;
    upcomingLessons: number | null;
    children: number | null;
    tasks: { done: number; total: number } | null;
  };
  spending: { key: string; expenses: string; lessons: string }[];
  trend: { month: string; expenses: string; lessons: string }[];
  reminders: { id: string; name: string; amount: string; currency: string; dueDate: string; dueTime: string; category: PaymentCategory; child: { id: string; name: string } | null }[];
  outstanding: { byChild: OutstandingRow[]; byTeacher: OutstandingRow[] };
  kids: { id: string; name: string; tasksDone: number; tasksWaiting: number; tasksTotal: number; earned: number; lost: number }[];
  recent: {
    lessons: Expense[];
    transactions: Expense[];
    payments: { id: string; paymentId: string; name: string; amount: string; currency: string; paidAt: string; paidBy: string | null; receiptCheck: ReceiptCheckStatus | null }[];
    tasks: { id: string; title: string; points: number; status: ChildTaskStatus; daily: boolean; updatedAt: string; child: { id: string; name: string } }[];
  };
}
export type OutstandingRow = { id: string; name: string; amount: string; count: number };
export const getInsights = (s: Session, period: InsightsPeriod, range: { from?: string; to?: string } | undefined, r: (s: Session) => void) =>
  call<Insights>(s, `/insights?period=${period}${period === 'custom' && range?.from && range?.to ? `&from=${enc(range.from)}&to=${enc(range.to)}` : ''}`, r);


// ───────────────────────── Countries ─────────────────────────

/** A country the family spends in; each has its own expenses, income and reports in its currency. */
export interface Country {
  id: string;
  /** ISO code (SA, EG, ...) or EU. */
  code: string;
  currency: CurrencyCode;
  isDefault: boolean;
}

export const COUNTRY_CODES = ['SA', 'EG', 'AE', 'KW', 'QA', 'BH', 'US', 'EU'] as const;

export const getCountries = (session: Session, onRefresh: (session: Session) => void) => authenticatedRequest<Country[]>(session, '/countries', {}, onRefresh);
export const addCountry = (session: Session, code: string, onRefresh: (session: Session) => void) =>
  authenticatedRequest<Country>(session, '/countries', { method: 'POST', body: { code } }, onRefresh);
export const setDefaultCountry = (session: Session, id: string, onRefresh: (session: Session) => void) =>
  authenticatedRequest<Country[]>(session, `/countries/${encodeURIComponent(id)}/default`, { method: 'PUT' }, onRefresh);
export const removeCountry = (session: Session, id: string, onRefresh: (session: Session) => void) =>
  authenticatedRequest<null>(session, `/countries/${encodeURIComponent(id)}`, { method: 'DELETE' }, onRefresh);

// ───────────────────────── Savings vault ─────────────────────────

export interface VaultEntry {
  id: string;
  direction: 'DEPOSIT' | 'WITHDRAW';
  amount: string;
  currency: CurrencyCode;
  note: string | null;
  date: string;
}

export interface Vault {
  currency: CurrencyCode;
  /** Everything saved, in the family currency (null when a rate is missing). */
  total: string | null;
  balances: { currency: CurrencyCode; amount: string }[];
  entries: VaultEntry[];
  devices: { id: string; label: string | null; createdAt: string; lastUsedAt: string | null }[];
}

export type VaultUnlock = { token: string; expiresAt: string };

export const unlockVault = (session: Session, input: { password: string } | { deviceKey: string }, onRefresh: (session: Session) => void) =>
  authenticatedRequest<VaultUnlock>(session, '/vault/unlock', { method: 'POST', body: input }, onRefresh);
const vaultHeaders = (token: string) => ({ 'X-Vault-Token': token });
export const getVault = (session: Session, token: string, onRefresh: (session: Session) => void) =>
  authenticatedRequest<Vault>(session, '/vault', { headers: vaultHeaders(token) }, onRefresh);
export const addVaultEntry = (session: Session, token: string, input: { direction: 'DEPOSIT' | 'WITHDRAW'; amount: string; currency: string; note?: string }, onRefresh: (session: Session) => void) =>
  authenticatedRequest<Vault>(session, '/vault/entries', { method: 'POST', body: input, headers: vaultHeaders(token) }, onRefresh);
export const deleteVaultEntry = (session: Session, token: string, id: string, onRefresh: (session: Session) => void) =>
  authenticatedRequest<Vault>(session, `/vault/entries/${encodeURIComponent(id)}`, { method: 'DELETE', headers: vaultHeaders(token) }, onRefresh);
export const trustVaultDevice = (session: Session, token: string, label: string, onRefresh: (session: Session) => void) =>
  authenticatedRequest<{ id: string; deviceKey: string }>(session, '/vault/devices', { method: 'POST', body: { label }, headers: vaultHeaders(token) }, onRefresh);
export const forgetVaultDevice = (session: Session, token: string, id: string, onRefresh: (session: Session) => void) =>
  authenticatedRequest<null>(session, `/vault/devices/${encodeURIComponent(id)}`, { method: 'DELETE', headers: vaultHeaders(token) }, onRefresh);
