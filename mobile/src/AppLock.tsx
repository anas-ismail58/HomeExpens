import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Pressable, View } from 'react-native';
import { PrimaryButton } from './components';
import { usePreferences, useStyles } from './preferences';
import { useSession } from './SessionContext';
import { Text } from './typography';
import { biometricKind, confirmWithBiometrics } from './vaultAuth';

/**
 * Locks the whole app with Face ID / fingerprint (the phone passcode as fallback) when the user turns it on
 * for this phone: on opening the app, and on coming back after a short while. Nothing is stored about the
 * face or finger — the phone does the check. The screen is covered while the app is in the background, so
 * the app switcher shows nothing.
 */
const STORAGE_KEY = 'app-lock:on';
/** Back within this many ms (e.g. a quick look at another app): no new prompt. */
const GRACE_MS = 10_000;

type AppLockState = {
  /** 'face' | 'fingerprint' when this phone can use it, otherwise null (web, older builds, not enrolled). */
  kind: 'face' | 'fingerprint' | null;
  enabled: boolean;
  /** Turning it on asks for Face ID first; returns whether the change was made. */
  setEnabled: (on: boolean) => Promise<boolean>;
};

const AppLockContext = createContext<AppLockState>({ kind: null, enabled: false, setEnabled: async () => false });

export function useAppLock() {
  return useContext(AppLockContext);
}

export function AppLockProvider({ children }: { children: ReactNode }) {
  const { t } = usePreferences();
  const { session, signOut } = useSession();
  const [kind, setKind] = useState<'face' | 'fingerprint' | null>(null);
  const [enabled, setEnabledState] = useState(false);
  const [checked, setChecked] = useState(false);
  const [locked, setLocked] = useState(true);
  const [prompting, setPrompting] = useState(false);
  const backgroundAt = useRef<number | null>(null);
  const active = Boolean(session) && enabled && kind !== null;

  useEffect(() => {
    let alive = true;
    void Promise.all([biometricKind(), AsyncStorage.getItem(STORAGE_KEY).catch(() => null)]).then(([found, saved]) => {
      if (!alive) return;
      setKind(found);
      setEnabledState(saved === '1');
      setChecked(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const unlock = useCallback(async () => {
    if (prompting) return;
    setPrompting(true);
    const ok = await confirmWithBiometrics(t('appLockPrompt'), t('cancel'));
    setPrompting(false);
    if (ok) setLocked(false);
  }, [prompting, t]);

  // Ask once when the app opens (if locking is on).
  const askedAtStart = useRef(false);
  useEffect(() => {
    if (!checked || askedAtStart.current) return;
    askedAtStart.current = true;
    // After this render, not inside it.
    if (active) void Promise.resolve().then(unlock);
  }, [active, checked, unlock]);

  // Cover the screen in the background; ask again when back after the grace period.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (!active) return;
      if (state === 'background') {
        backgroundAt.current = Date.now();
        setLocked(true);
      } else if (state === 'active' && backgroundAt.current !== null) {
        const away = Date.now() - backgroundAt.current;
        backgroundAt.current = null;
        if (away < GRACE_MS) setLocked(false);
        else void unlock();
      }
    });
    return () => subscription.remove();
  }, [active, unlock]);

  const setEnabled = useCallback(
    async (on: boolean) => {
      // Confirm it's really the owner before turning it on or off.
      if (!(await confirmWithBiometrics(t('appLockPrompt'), t('cancel')))) return false;
      setEnabledState(on);
      setLocked(false);
      await AsyncStorage.setItem(STORAGE_KEY, on ? '1' : '0').catch(() => undefined);
      return true;
    },
    [t],
  );

  const value = useMemo(() => ({ kind, enabled, setEnabled }), [enabled, kind, setEnabled]);
  const covered = active && (!checked || locked);
  return (
    <AppLockContext.Provider value={value}>
      {children}
      {covered ? <LockScreen kind={kind} busy={prompting} onUnlock={() => void unlock()} onSignOut={() => void signOut()} /> : null}
    </AppLockContext.Provider>
  );
}

function LockScreen({ kind, busy, onUnlock, onSignOut }: { kind: 'face' | 'fingerprint' | null; busy: boolean; onUnlock: () => void; onSignOut: () => void }) {
  const { t, colors } = usePreferences();
  const s = useStyles((c) => ({
    cover: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.background, alignItems: 'center' as const, justifyContent: 'center' as const, padding: 32, gap: 18, zIndex: 1000 },
    icon: { width: 96, height: 96, borderRadius: 32, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.primarySoft },
    title: { color: c.text, fontSize: 22, fontWeight: '800' as const, textAlign: 'center' as const },
    body: { color: c.muted, fontSize: 14, textAlign: 'center' as const },
    link: { color: c.muted, fontSize: 14, fontWeight: '700' as const, textAlign: 'center' as const },
  }));
  return (
    <View style={s.cover} accessibilityViewIsModal>
      <View style={s.icon}><Ionicons name={kind === 'fingerprint' ? 'finger-print' : 'scan'} size={48} color={colors.primary} /></View>
      <Text style={s.title}>{t('appLockedTitle')}</Text>
      <Text style={s.body}>{t('appLockedBody')}</Text>
      <View style={{ alignSelf: 'stretch' }}>
        <PrimaryButton label={kind === 'fingerprint' ? t('vaultOpenFingerprint') : t('vaultOpenFace')} icon={kind === 'fingerprint' ? 'finger-print' : 'scan'} busy={busy} onPress={onUnlock} />
      </View>
      <Pressable onPress={onSignOut} accessibilityRole="button"><Text style={s.link}>{t('signOut')}</Text></Pressable>
    </View>
  );
}
