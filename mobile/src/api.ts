import { Platform } from 'react-native';
import { clearRefreshToken, readRefreshToken, writeRefreshToken } from './session';

const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === 'web'
    ? '/api'
    : Platform.OS === 'android'
      ? 'http://10.0.2.2:5001/api'
      : 'http://localhost:5001/api')
).replace(/\/+$/, '');

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string };
  family: { id: string; name: string; currency: string; timezone: string };
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
  member: { id: string; name: string } | null;
  category: { key: string | null; nameAr: string; nameEn: string };
  subcategory: { key: string | null; nameAr: string; nameEn: string } | null;
  isRecurring: boolean;
}

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

export async function signIn(email: string, password: string) {
  const session = await publicRequest<Session>('/auth/login', { email, password });
  await writeRefreshToken(session.refreshToken);
  return session;
}

export async function register(input: { email: string; password: string; name: string; familyName: string }) {
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

export async function addHomeLesson(
  session: Session,
  input: { childId: string; amount: string; description?: string; occurredAt: string },
  onRefresh: (session: Session) => void,
) {
  return authenticatedRequest<Expense>(session, '/expenses/home-lessons', { method: 'POST', body: input }, onRefresh);
}

export async function addRecurringTuition(
  session: Session,
  input: { childId: string; amount: string; description: string },
  onRefresh: (session: Session) => void,
) {
  return authenticatedRequest<{ id: string }>(session, '/expenses/recurring-home-lessons', { method: 'POST', body: input }, onRefresh);
}

export async function addHouseholdExpense(
  session: Session,
  input: { amount: string; subcategoryKey?: string; description?: string; occurredAt: string },
  onRefresh: (session: Session) => void,
) {
  return authenticatedRequest<Expense>(session, '/expenses/household', { method: 'POST', body: input }, onRefresh);
}

export function apiBaseUrl() {
  return API_BASE_URL;
}