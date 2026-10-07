import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { getAccount, restoreSession, signOut as apiSignOut, type PermissionKey, type Session } from './api';
import { forgetDevicePushToken } from './notifications';

type ApiCall<T> = (session: Session, onRefresh: (session: Session) => void) => Promise<T>;

type SessionContextValue = {
  session: Session | null;
  ready: boolean;
  setSession: (session: Session | null) => void;
  signOut: () => Promise<void>;
  /** Runs an authenticated API call with the latest session; token refreshes update the context. */
  call: <T>(fn: ApiCall<T>) => Promise<T>;
  /** Re-reads role and permissions from the server (they can change while the app is open). */
  refreshAccount: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const sessionRef = useRef<Session | null>(null);

  const setSession = useCallback((next: Session | null) => {
    sessionRef.current = next;
    setSessionState(next);
  }, []);

  useEffect(() => {
    let active = true;
    restoreSession()
      .then((restored) => {
        if (active) setSession(restored);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [setSession]);

  const call = useCallback(<T,>(fn: ApiCall<T>) => {
    const current = sessionRef.current;
    if (!current) return Promise.reject(new Error('يجب تسجيل الدخول أولًا.'));
    return fn(current, setSession);
  }, [setSession]);

  const signOut = useCallback(async () => {
    const current = sessionRef.current;
    if (current) {
      // Unlink this device first so the next person to sign in here doesn't get these pushes.
      await forgetDevicePushToken(current, setSession).catch(() => undefined);
      await apiSignOut(current).catch(() => undefined);
    }
    setSession(null);
  }, [setSession]);

  const refreshAccount = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    try {
      const account = await getAccount(current, setSession);
      const latest = sessionRef.current;
      if (latest) setSession({ ...latest, ...account });
    } catch (error) {
      // Removed from the family: the server rejects the session.
      if ((error as { status?: number }).status === 401) setSession(null);
    }
  }, [setSession]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshAccount();
    });
    return () => subscription.remove();
  }, [refreshAccount]);

  const value = useMemo(() => ({ session, ready, setSession, signOut, call, refreshAccount }), [session, ready, setSession, signOut, call, refreshAccount]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

/** Same as useSession but asserts a signed-in user (for screens behind the auth guard). */
export function useAuthedSession() {
  const value = useSession();
  if (!value.session) throw new Error('No active session');
  return { ...value, session: value.session };
}

/**
 * Permission check for showing or hiding UI. The server enforces the same rules, so this only
 * decides what to display — it is never the security boundary.
 */
export function useCan() {
  const { session } = useSession();
  return useCallback(
    (key: PermissionKey) => Boolean(session && (session.user.isAdmin || session.user.permissions.includes(key))),
    [session],
  );
}
