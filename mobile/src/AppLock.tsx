import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, View } from 'react-native';
import { usePreferences, useStyles } from './preferences';
import { useSession } from './SessionContext';
import { biometricKind, confirmWithBiometrics } from './vaultAuth';

/**
 * Sign-in with Face ID / fingerprint (the phone passcode as fallback) when the user turns it on for this phone.
 * The app opens on the login page; there Face ID uses the sign-in kept on this phone (see SessionContext).
 * Coming back after a while also returns to the login page. Nothing is stored about the face or finger —
 * the phone does the check. The screen is covered while the app is in the background, so the app switcher
 * shows nothing.
 */
const STORAGE_KEY = 'app-lock:on';
/** Back within this many ms (e.g. a quick look at another app): stays signed in. */
const GRACE_MS = 10_000;

type AppLockState = {
  /** 'face' | 'fingerprint' when this phone can use it, otherwise null (web, older builds, not enrolled). */
  kind: 'face' | 'fingerprint' | null;
  enabled: boolean;
  /** Turning it on asks for Face ID first; returns whether the change was made. */
  setEnabled: (on: boolean) => Promise<boolean>;
  /** Whether the login page can offer Face ID (it is on and a sign-in is kept on this phone). */
  canResume: boolean;
  /** Asks for Face ID, then signs in with the kept sign-in; returns whether it worked. */
  resume: () => Promise<boolean>;
};

const AppLockContext = createContext<AppLockState>({ kind: null, enabled: false, setEnabled: async () => false, canResume: false, resume: async () => false });

export function useAppLock() {
  return useContext(AppLockContext);
}

export function AppLockProvider({ children }: { children: ReactNode }) {
  const { t } = usePreferences();
  const { session, saved, resume: resumeSaved, lock } = useSession();
  const [kind, setKind] = useState<'face' | 'fingerprint' | null>(null);
  const [enabled, setEnabledState] = useState(false);
  const [hidden, setHidden] = useState(false);
  const backgroundAt = useRef<number | null>(null);
  const active = Boolean(session) && enabled && kind !== null;

  useEffect(() => {
    let alive = true;
    void Promise.all([biometricKind(), AsyncStorage.getItem(STORAGE_KEY).catch(() => null)]).then(([found, stored]) => {
      if (!alive) return;
      setKind(found);
      setEnabledState(stored === '1');
    });
    return () => {
      alive = false;
    };
  }, []);

  // Cover the screen in the background; back after the grace period, go to the login page.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (!active) return;
      if (state === 'background') {
        backgroundAt.current = Date.now();
        setHidden(true);
      } else if (state === 'active' && backgroundAt.current !== null) {
        const away = Date.now() - backgroundAt.current;
        backgroundAt.current = null;
        if (away >= GRACE_MS) lock();
        setHidden(false);
      }
    });
    return () => subscription.remove();
  }, [active, lock]);

  const setEnabled = useCallback(
    async (on: boolean) => {
      // Confirm it's really the owner before turning it on or off.
      if (!(await confirmWithBiometrics(t('appLockPrompt'), t('cancel')))) return false;
      setEnabledState(on);
      await AsyncStorage.setItem(STORAGE_KEY, on ? '1' : '0').catch(() => undefined);
      return true;
    },
    [t],
  );

  const canResume = Boolean(saved) && enabled && kind !== null;
  const resume = useCallback(async () => {
    if (!canResume || !(await confirmWithBiometrics(t('appLockPrompt'), t('cancel')))) return false;
    resumeSaved();
    return true;
  }, [canResume, t, resumeSaved]);

  const value = useMemo(() => ({ kind, enabled, setEnabled, canResume, resume }), [canResume, enabled, kind, resume, setEnabled]);
  return (
    <AppLockContext.Provider value={value}>
      {children}
      {active && hidden ? <PrivacyCover /> : null}
    </AppLockContext.Provider>
  );
}

/** Plain cover while the app is in the background, so the app switcher doesn't show family numbers. */
function PrivacyCover() {
  const { colors } = usePreferences();
  const s = useStyles((c) => ({
    cover: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.background, alignItems: 'center' as const, justifyContent: 'center' as const, zIndex: 1000 },
    icon: { width: 96, height: 96, borderRadius: 32, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.primarySoft },
  }));
  return (
    <View style={s.cover}>
      <View style={s.icon}><Ionicons name="lock-closed" size={44} color={colors.primary} /></View>
    </View>
  );
}
