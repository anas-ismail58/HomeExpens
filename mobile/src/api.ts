import { Platform } from 'react-native';
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

export type Role = 'FATHER' | 'MOTHER' | 'CHILD';
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
  | 'VIEW_INCOME';

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
  amount: string;
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

/** `as` is who the user said they are on the login screen; the server checks it against the account. */
export async function signIn(email: string, password: string, as?: 'FATHER' | 'MEMBER') {
  const session = await publicRequest<Session>('/auth/login', { email, password, as });
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

export async function authenticatedRequest<T>(
  session: Session,
  path: string,
  options: { method?: string; body?: unknown } = {},
  onRefresh: (session: Session) => void,
): Promise<T> {
  const send = (token: string) =>
    fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
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
export type RecurringFrequency = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
type WithReminder<T> = T & { reminder: Payment | null };

export async function addHomeLesson(
  session: Session,
  input: { childId: string; amount: string; description?: string; occurredAt: string; reminder?: ReminderOption } & TeacherRef,
  onRefresh: (session: Session) => void,
) {
  return authenticatedRequest<WithReminder<Expense>>(session, '/expenses/home-lessons', { method: 'POST', body: input }, onRefresh);
}

export async function addRecurringTuition(
  session: Session,
  input: { childId: string; amount: string; description: string; frequency: RecurringFrequency; startDate: string; dueTime: string; reminder?: ReminderOption } & TeacherRef,
  onRefresh: (session: Session) => void,
) {
  return authenticatedRequest<WithReminder<RecurringFee>>(session, '/expenses/recurring-home-lessons', { method: 'POST', body: input }, onRefresh);
}

export async function addHouseholdExpense(
  session: Session,
  input: { amount: string; subcategoryKey?: string; description?: string; occurredAt: string; reminder?: ReminderOption },
  onRefresh: (session: Session) => void,
) {
  return authenticatedRequest<WithReminder<Expense>>(session, '/expenses/household', { method: 'POST', body: input }, onRefresh);
}

export async function addRecurringHousehold(
  session: Session,
  input: { amount: string; subcategoryKey?: string; description: string; frequency: RecurringFrequency; startDate: string; dueTime: string; reminder?: ReminderOption },
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
  description: string;
  frequency: string;
  startDate: string;
  child: { id: string; name: string } | null;
  kind?: 'LESSON' | 'HOUSEHOLD';
  section?: { key: string | null; nameAr: string; nameEn: string } | null;
  teacher?: Teacher | null;
}

export interface ChildDetails {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  dateOfBirth: string | null;
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

export const updateExpense = (s: Session, id: string, input: { amount?: string; description?: string; notes?: string | null }, r: (s: Session) => void) =>
  call<Expense>(s, `/expenses/${enc(id)}`, r, 'PUT', input);

export const addIncome = (s: Session, input: { amount: string; source: string; date: string; description?: string }, r: (s: Session) => void) =>
  call<{ id: string }>(s, '/incomes', r, 'POST', input);
export const deleteIncome = (s: Session, id: string, r: (s: Session) => void) => call<null>(s, `/incomes/${enc(id)}`, r, 'DELETE');

export interface IncomeSummary {
  month: string;
  currency: string;
  salary: { id: string; amount: string; description: string | null; payDay: number; since: string } | null;
  totals: { salary: string; extraIncome: string; income: string; expenses: string; household: string; lessons: string; remaining: string; spentRatio: number | null };
  incomes: { id: string; amount: string; source: string; description: string | null; date: string; createdBy: { id: string; name: string } | null }[];
}

export const getIncomeSummary = (s: Session, month: string, r: (s: Session) => void) => call<IncomeSummary>(s, `/incomes/summary?month=${enc(month)}`, r);
export const setSalary = (s: Session, input: { amount: string; payDay: number; description?: string }, r: (s: Session) => void) =>
  call<IncomeSummary>(s, '/incomes/salary', r, 'PUT', input);
export const removeSalary = (s: Session, r: (s: Session) => void) => call<null>(s, '/incomes/salary', r, 'DELETE');

// ───────────── Payments ─────────────

export type PaymentCategory = 'BILL' | 'TUITION' | 'COURSE' | 'SUBSCRIPTION' | 'RENT' | 'INTERNET' | 'MOBILE' | 'INSURANCE' | 'INSTALLMENT' | 'LOAN' | 'OTHER';
export type PaymentFrequency = 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'YEARLY' | 'CUSTOM';
export type PaymentStatus = 'UPCOMING' | 'DUE_SOON' | 'DUE_TODAY' | 'OVERDUE' | 'PAID' | 'CANCELLED';

export interface Payment {
  id: string;
  name: string;
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
  createdAt: string;
}

export interface PaymentDetails extends Payment {
  history: { id: string; dueDate: string; amount: string; paidAt: string; paidBy: { id: string; name: string } | null; status: 'PAID' }[];
}

export interface PaymentInput {
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
}

export const getPayments = (s: Session, r: (s: Session) => void, status?: PaymentStatus | 'OPEN') =>
  call<Payment[]>(s, `/payments${status ? `?status=${status}` : ''}`, r);
export const getPayment = (s: Session, id: string, r: (s: Session) => void) => call<PaymentDetails>(s, `/payments/${enc(id)}`, r);
export const createPayment = (s: Session, input: PaymentInput, r: (s: Session) => void) => call<Payment>(s, '/payments', r, 'POST', input);
export const updatePayment = (s: Session, id: string, input: Partial<PaymentInput>, r: (s: Session) => void) => call<Payment>(s, `/payments/${enc(id)}`, r, 'PUT', input);
export const deletePayment = (s: Session, id: string, r: (s: Session) => void) => call<null>(s, `/payments/${enc(id)}`, r, 'DELETE');
export const payPayment = (s: Session, id: string, r: (s: Session) => void) =>
  call<Payment & { paidCycle: { dueDate: string; paidAt: string } }>(s, `/payments/${enc(id)}/pay`, r, 'POST');
export const cancelPayment = (s: Session, id: string, r: (s: Session) => void) => call<Payment>(s, `/payments/${enc(id)}/cancel`, r, 'POST');

// ───────────── Notifications ─────────────

export type NotificationType = 'PAYMENT_REMINDER' | 'PAYMENT_OVERDUE' | 'INVITATION' | 'PERMISSION_CHANGE' | 'FAMILY_EVENT';

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

export const getNotifications = (s: Session, r: (s: Session) => void) => call<{ items: AppNotification[]; unreadCount: number }>(s, '/notifications', r);
export const markNotificationRead = (s: Session, id: string, r: (s: Session) => void) => call<null>(s, `/notifications/${enc(id)}/read`, r, 'PUT');
export const markAllNotificationsRead = (s: Session, r: (s: Session) => void) => call<{ updated: number }>(s, '/notifications/read-all', r, 'PUT');
export const deleteNotification = (s: Session, id: string, r: (s: Session) => void) => call<null>(s, `/notifications/${enc(id)}`, r, 'DELETE');
export const registerPushToken = (s: Session, token: string, platform: string, r: (s: Session) => void) => call<null>(s, '/push-tokens', r, 'POST', { token, platform });
export const unregisterPushToken = (s: Session, token: string, r: (s: Session) => void) => call<null>(s, '/push-tokens', r, 'DELETE', { token });

// ───────────── Dashboard ─────────────

export interface Dashboard {
  month: string;
  currency: string;
  totals: { income: string | null; salary: string | null; expenses: string; balance: string | null; spentRatio: number | null; hasSalary: boolean };
  payments: { today: string; overdue: Payment[]; dueToday: Payment[]; upcoming: Payment[] };
  recentExpenses: Expense[];
  members: FamilyMember[];
  unreadNotifications: number;
}

export const getDashboard = (s: Session, month: string, r: (s: Session) => void) => call<Dashboard>(s, `/dashboard?month=${enc(month)}`, r);

// ───────────── Teachers ─────────────

export const getTeachers = (s: Session, r: (s: Session) => void) => call<Teacher[]>(s, '/teachers', r);
export const addTeacher = (s: Session, input: { name: string; phone?: string | null; subject?: string | null }, r: (s: Session) => void) =>
  call<Teacher>(s, '/teachers', r, 'POST', input);
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

/** Enters another family as its admin. Returns a new session; the old one is revoked by the server. */
export async function switchFamily(s: Session, familyId: string, r: (s: Session) => void) {
  const refreshToken = (await readRefreshToken()) ?? s.refreshToken;
  const next = await call<Session>(s, '/admin/switch-family', r, 'POST', { familyId, refreshToken });
  await writeRefreshToken(next.refreshToken);
  return next;
}
