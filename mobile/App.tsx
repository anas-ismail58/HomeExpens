import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { FinanceScreen } from './src/FinanceScreen';
import { LoginScreen } from './src/LoginScreen';
import { restoreSession, signOut, type Session } from './src/api';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

type Language = 'ar' | 'en';
type ThemePreference = 'light' | 'dark' | 'system';
type HealthState =
  | { kind: 'checking' }
  | { kind: 'connected'; latencyMs: number; uptimeSec: number }
  | { kind: 'database-offline'; message: string }
  | { kind: 'api-error'; message: string }
  | { kind: 'offline'; message: string };

type HealthPayload = {
  success?: boolean;
  message?: string;
  code?: string;
  data?: { latencyMs?: number; uptimeSec?: number };
};

const STORAGE_KEY = 'family-expenses.mobile-preferences';
const translations = {
  ar: {
    brand: 'مصروف العائلة',
    eyebrow: 'إدارة مالية للأسرة',
    section: 'حالة النظام',
    connectedTitle: 'كل شيء متصل',
    connectedBody: 'الخادم وقاعدة البيانات يعملان بشكل طبيعي.',
    checkingTitle: 'جارٍ فحص الاتصال',
    checkingBody: 'نتحقق من الخادم وقاعدة البيانات.',
    databaseTitle: 'قاعدة البيانات غير متاحة',
    databaseBody: 'الخادم يستجيب، لكن قاعدة البيانات لا تقبل الاتصالات.',
    apiErrorTitle: 'الخادم يحتاج إلى فحص',
    apiErrorBody: 'وصلنا إلى الخادم، لكنه أعاد خطأ.',
    offlineTitle: 'تعذّر الاتصال',
    offlineBody: 'تحقق من عنوان API ومن اتصال الهاتف بالشبكة.',
    server: 'الخادم',
    database: 'قاعدة البيانات',
    connected: 'متصل',
    disconnected: 'غير متصل',
    checking: 'جارٍ الفحص',
    latency: 'زمن الاستجابة',
    uptime: 'مدة التشغيل',
    milliseconds: 'ملّي ثانية',
    seconds: 'ثانية',
    refresh: 'تحديث الحالة',
    back: 'العودة',
    preferences: 'التفضيلات',
    language: 'اللغة',
    arabic: 'العربية',
    english: 'English',
    appearance: 'المظهر',
    light: 'فاتح',
    dark: 'داكن',
    system: 'تلقائي',
    connection: 'اتصال الخادم',
    apiUrl: 'عنوان API',
    apiHint: 'على الهاتف الحقيقي استخدم عنوان IP لجهاز الكمبيوتر على الشبكة نفسها.',
    save: 'حفظ العنوان',
    invalidUrl: 'أدخل عنوانًا يبدأ بـ http:// أو https://',
    saved: 'تم حفظ عنوان الخادم',
    retry: 'إعادة المحاولة',
    footer: 'مصروف العائلة · معاينة تطبيق الهاتف',
  },
  en: {
    brand: 'Family Expenses',
    eyebrow: 'Family finance, together',
    section: 'SYSTEM STATUS',
    connectedTitle: 'Everything is connected',
    connectedBody: 'The server and database are responding normally.',
    checkingTitle: 'Checking connection',
    checkingBody: 'Testing the server and database connection.',
    databaseTitle: 'Database unavailable',
    databaseBody: 'The server responded, but the database is not accepting connections.',
    apiErrorTitle: 'Server needs attention',
    apiErrorBody: 'The server responded with an error.',
    offlineTitle: 'Can’t connect',
    offlineBody: 'Check the API address and the phone’s network connection.',
    server: 'Server',
    database: 'Database',
    connected: 'Connected',
    disconnected: 'Disconnected',
    checking: 'Checking',
    latency: 'Response time',
    uptime: 'Uptime',
    milliseconds: 'ms',
    seconds: 'sec',
    refresh: 'Refresh status',
    back: 'Back',
    preferences: 'Preferences',
    language: 'Language',
    arabic: 'العربية',
    english: 'English',
    appearance: 'Appearance',
    light: 'Light',
    dark: 'Dark',
    system: 'System',
    connection: 'Server connection',
    apiUrl: 'API address',
    apiHint: 'On a physical phone, use your computer’s IP address on the same network.',
    save: 'Save address',
    invalidUrl: 'Enter an address starting with http:// or https://',
    saved: 'Server address saved',
    retry: 'Try again',
    footer: 'Family Expenses · Mobile preview',
  },
} as const;

const defaultApiUrl =
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === 'web'
    ? '/api'
    : Platform.OS === 'android'
      ? 'http://10.0.2.2:5001/api'
      : 'http://localhost:5001/api');

const palettes = {
  light: {
    background: '#f1f5f3',
    surface: '#ffffff',
    surfaceMuted: '#e6eeea',
    border: '#d5e0da',
    text: '#172b27',
    muted: '#61736c',
    primary: '#0c5949',
    primaryText: '#ffffff',
    accent: '#d6eddf',
    success: '#19714c',
    successSoft: '#e1f2e8',
    warning: '#94620a',
    warningSoft: '#f9edcf',
    danger: '#ad392d',
    dangerSoft: '#fae6e0',
  },
  dark: {
    background: '#111c1a',
    surface: '#1b2925',
    surfaceMuted: '#263631',
    border: '#33463f',
    text: '#eaf2ed',
    muted: '#a1b2a9',
    primary: '#245f50',
    primaryText: '#f3fff8',
    accent: '#29483b',
    success: '#75d19b',
    successSoft: '#203c30',
    warning: '#f0c36b',
    warningSoft: '#40371f',
    danger: '#ff9c8d',
    dangerSoft: '#482a26',
  },
};

function normalizeApiUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

async function requestHealth(baseUrl: string, signal?: AbortSignal): Promise<HealthState> {
  try {
    const response = await fetch(`${normalizeApiUrl(baseUrl)}/health`, { signal });
    const payload = (await response.json().catch(() => ({}))) as HealthPayload;

    if (response.ok && payload.success) {
      return {
        kind: 'connected',
        latencyMs: payload.data?.latencyMs ?? 0,
        uptimeSec: payload.data?.uptimeSec ?? 0,
      };
    }
    if (payload.code === 'DB_UNAVAILABLE') {
      return { kind: 'database-offline', message: payload.message ?? '' };
    }
    return { kind: 'api-error', message: payload.message ?? `HTTP ${response.status}` };
  } catch {
    return { kind: 'offline', message: '' };
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthenticatedApp />
    </SafeAreaProvider>
  );
}

function AuthenticatedApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [showStatus, setShowStatus] = useState(false);

  useEffect(() => {
    let active = true;
    restoreSession()
      .then((restored) => {
        if (active) setSession(restored);
      })
      .finally(() => {
        if (active) setSessionReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!sessionReady) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f3' }}>
        <ActivityIndicator size="large" color="#0c5949" />
      </SafeAreaView>
    );
  }

  if (!session) return <LoginScreen onAuthenticated={setSession} />;
  if (showStatus) return <MobileStatusScreen onBack={() => setShowStatus(false)} />;

  return (
    <FinanceScreen
      session={session}
      onSessionChange={setSession}
      onShowStatus={() => setShowStatus(true)}
      onSignOut={() => {
        void signOut(session).catch(() => undefined).finally(() => setSession(null));
      }}
    />
  );
}

function MobileStatusScreen({ onBack }: { onBack: () => void }) {
  const systemColorScheme = useColorScheme();
  const [language, setLanguage] = useState<Language>('ar');
  const [themePreference, setThemePreference] = useState<ThemePreference>('system');
  const [apiUrl, setApiUrl] = useState(defaultApiUrl);
  const [apiDraft, setApiDraft] = useState(defaultApiUrl);
  const [health, setHealth] = useState<HealthState>({ kind: 'checking' });
  const [isChecking, setIsChecking] = useState(true);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const text = translations[language];
  const isRtl = language === 'ar';
  const resolvedTheme = themePreference === 'system' ? (systemColorScheme === 'dark' ? 'dark' : 'light') : themePreference;
  const colors = palettes[resolvedTheme];

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (!active || !value) return;
        const saved = JSON.parse(value) as Partial<{
          language: Language;
          theme: ThemePreference;
          apiUrl: string;
        }>;
        if (saved.language === 'ar' || saved.language === 'en') setLanguage(saved.language);
        if (saved.theme === 'light' || saved.theme === 'dark' || saved.theme === 'system') {
          setThemePreference(saved.theme);
        }
        if (typeof saved.apiUrl === 'string' && saved.apiUrl.length > 0) {
          setApiUrl(saved.apiUrl);
          setApiDraft(saved.apiUrl);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setPreferencesReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    let active = true;
    const controller = new AbortController();
    requestHealth(apiUrl, controller.signal)
      .then((result) => {
        if (active) setHealth(result);
      })
      .finally(() => {
        if (active) setIsChecking(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [apiUrl, preferencesReady]);

  useEffect(() => {
    if (!preferencesReady) return;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ language, theme: themePreference, apiUrl })).catch(
      () => undefined,
    );
  }, [apiUrl, language, preferencesReady, themePreference]);

  const savePreferences = (updates: Partial<{ language: Language; theme: ThemePreference }>) => {
    if (updates.language) setLanguage(updates.language);
    if (updates.theme) setThemePreference(updates.theme);
  };

  const refresh = async () => {
    setIsChecking(true);
    setHealth({ kind: 'checking' });
    setHealth(await requestHealth(apiUrl));
    setIsChecking(false);
  };

  const saveApiUrl = async () => {
    const nextUrl = normalizeApiUrl(apiDraft);
    if (!/^https?:\/\/\S+$/i.test(nextUrl)) {
      Alert.alert(text.connection, text.invalidUrl);
      return;
    }
    setApiDraft(nextUrl);
    if (nextUrl === apiUrl) {
      void refresh();
      Alert.alert(text.connection, text.saved);
      return;
    }
    setHealth({ kind: 'checking' });
    setIsChecking(true);
    setApiUrl(nextUrl);
    Alert.alert(text.connection, text.saved);
  };

  const connected = health.kind === 'connected';
  const apiReachable = connected || health.kind === 'database-offline' || health.kind === 'api-error';
  const headline = connected
    ? text.connectedTitle
    : health.kind === 'checking'
      ? text.checkingTitle
      : health.kind === 'database-offline'
        ? text.databaseTitle
        : health.kind === 'api-error'
          ? text.apiErrorTitle
          : text.offlineTitle;
  const supportingText = connected
    ? text.connectedBody
    : health.kind === 'checking'
      ? text.checkingBody
      : health.kind === 'database-offline'
        ? text.databaseBody
        : health.kind === 'api-error'
          ? text.apiErrorBody
          : text.offlineBody;
  const statusColor = connected ? colors.success : health.kind === 'checking' ? colors.warning : colors.danger;
  const statusSoft = connected ? colors.successSoft : health.kind === 'checking' ? colors.warningSoft : colors.dangerSoft;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      <StatusBar style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={isChecking} onRefresh={() => void refresh()} tintColor={colors.primary} />
          }
        >
          <View style={[styles.header, isRtl && styles.rowReverse]}>
            <View style={[styles.brandMark, { backgroundColor: colors.primary }]}>
              <Text style={styles.brandMarkText}>م</Text>
            </View>
            <View style={styles.brandCopy}>
              <Text style={[styles.brandName, { color: colors.text, textAlign: isRtl ? 'right' : 'left' }]}>
                {text.brand}
              </Text>
              <Text style={[styles.eyebrow, { color: colors.muted, textAlign: isRtl ? 'right' : 'left' }]}>
                {text.eyebrow}
              </Text>
            </View>
            <Pressable onPress={onBack} style={styles.backButton} accessibilityRole="button">
              <Text style={styles.backButtonText}>{text.back}</Text>
            </Pressable>
            <View style={styles.liveMark}>
              <View style={[styles.liveDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.liveText, { color: statusColor }]}>{text.section}</Text>
            </View>
          </View>

          <View style={[styles.hero, { backgroundColor: colors.primary }]}>
            <View style={styles.heroTop}>
              <Text style={styles.heroLabel}>{text.section}</Text>
              <View style={[styles.heroBadge, { backgroundColor: statusSoft }]}>
                {isChecking ? <ActivityIndicator size="small" color={statusColor} /> : null}
                <View style={[styles.badgeDot, { backgroundColor: statusColor }]} />
                <Text style={[styles.heroBadgeText, { color: statusColor }]}>
                  {connected ? text.server : isChecking ? text.checkingTitle : text.database}
                </Text>
              </View>
            </View>
            <Text style={[styles.heroTitle, { textAlign: isRtl ? 'right' : 'left' }]}>{headline}</Text>
            <Text style={[styles.heroBody, { textAlign: isRtl ? 'right' : 'left' }]}>{supportingText}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={text.retry}
              disabled={isChecking}
              onPress={() => void refresh()}
              style={({ pressed }) => [
                styles.refreshButton,
                { alignSelf: isRtl ? 'flex-end' : 'flex-start', flexDirection: isRtl ? 'row-reverse' : 'row' },
                pressed && styles.pressed,
                isChecking && styles.disabled,
              ]}
            >
              <Text style={styles.refreshGlyph}>↻</Text>
              <Text style={styles.refreshText}>{text.refresh}</Text>
            </Pressable>
          </View>

          <View style={styles.statusSection}>
            <Text style={[styles.sectionTitle, { color: colors.text, textAlign: isRtl ? 'right' : 'left' }]}>
              {text.section}
            </Text>
            <View style={[styles.statusList, { backgroundColor: colors.surface }]}>
              <StatusRow
                label={text.server}
                value={isChecking ? text.checking : apiReachable ? text.connected : text.disconnected}
                connected={apiReachable}
                colors={colors}
                isRtl={isRtl}
              />
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <StatusRow
                label={text.database}
                value={isChecking ? text.checking : connected ? text.connected : text.disconnected}
                connected={connected}
                colors={colors}
                isRtl={isRtl}
              />
            </View>
            {health.kind === 'connected' ? (
              <View style={styles.metrics}>
                <Metric label={text.latency} value={`${health.latencyMs} ${text.milliseconds}`} colors={colors} />
                <Metric label={text.uptime} value={`${health.uptimeSec} ${text.seconds}`} colors={colors} />
              </View>
            ) : null}
          </View>

          <View style={styles.preferencesSection}>
            <Text style={[styles.sectionTitle, { color: colors.text, textAlign: isRtl ? 'right' : 'left' }]}>
              {text.preferences}
            </Text>
            <Text style={[styles.controlLabel, { color: colors.muted, textAlign: isRtl ? 'right' : 'left' }]}>
              {text.language}
            </Text>
            <View style={[styles.segment, isRtl && styles.rowReverse]}>
              <Choice
                label={text.arabic}
                selected={language === 'ar'}
                onPress={() => savePreferences({ language: 'ar' })}
                colors={colors}
              />
              <Choice
                label={text.english}
                selected={language === 'en'}
                onPress={() => savePreferences({ language: 'en' })}
                colors={colors}
              />
            </View>

            <Text style={[styles.controlLabel, { color: colors.muted, textAlign: isRtl ? 'right' : 'left' }]}>
              {text.appearance}
            </Text>
            <View style={[styles.segment, isRtl && styles.rowReverse]}>
              {(['light', 'dark', 'system'] as const).map((option) => (
                <Choice
                  key={option}
                  label={text[option]}
                  selected={themePreference === option}
                  onPress={() => savePreferences({ theme: option })}
                  colors={colors}
                />
              ))}
            </View>

            <Text style={[styles.controlLabel, { color: colors.muted, textAlign: isRtl ? 'right' : 'left' }]}>
              {text.connection}
            </Text>
            <TextInput
              accessibilityLabel={text.apiUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={setApiDraft}
              placeholder="http://192.168.1.10:5001/api"
              placeholderTextColor={colors.muted}
              returnKeyType="done"
              spellCheck={false}
              style={[styles.urlInput, { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface }]}
              textAlign="left"
              value={apiDraft}
            />
            <Text style={[styles.hint, { color: colors.muted, textAlign: isRtl ? 'right' : 'left' }]}>
              {text.apiHint}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void saveApiUrl()}
              style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}
            >
              <Text style={styles.saveButtonText}>{text.save}</Text>
            </Pressable>
          </View>

          <Text style={[styles.footer, { color: colors.muted }]}>{text.footer}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function StatusRow({
  label,
  value,
  connected,
  colors,
  isRtl,
}: {
  label: string;
  value: string;
  connected: boolean;
  colors: (typeof palettes)['light'];
  isRtl: boolean;
}) {
  const color = connected ? colors.success : colors.danger;
  return (
    <View style={[styles.statusRow, isRtl && styles.rowReverse]}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text style={[styles.statusLabel, { color: colors.text, textAlign: isRtl ? 'right' : 'left' }]}>{label}</Text>
      <Text style={[styles.statusValue, { color, textAlign: isRtl ? 'left' : 'right' }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Metric({ label, value, colors }: { label: string; value: string; colors: (typeof palettes)['light'] }) {
  return (
    <View style={[styles.metric, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text style={[styles.metricLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: colors.text }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Choice({
  label,
  selected,
  onPress,
  colors,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: (typeof palettes)['light'];
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        { backgroundColor: selected ? colors.primary : colors.surface, borderColor: selected ? colors.primary : colors.border },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.choiceText, { color: selected ? colors.primaryText : colors.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: '#f1f5f3' },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 36, gap: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandMark: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: '#ffffff', fontSize: 25, fontWeight: '700' },
  brandCopy: { flex: 1 },
  brandName: { color: '#172b27', fontSize: 17, fontWeight: '700' },
  eyebrow: { color: '#61736c', fontSize: 12, marginTop: 3 },
  liveMark: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 122 },
  backButton: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 9, borderRadius: 8, backgroundColor: '#dcebe4' },
  backButtonText: { color: '#0c5949', fontSize: 11, fontWeight: '700' },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  liveText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  hero: { borderRadius: 22, padding: 22, minHeight: 202, justifyContent: 'center' },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 19 },
  heroLabel: { color: '#d5e9df', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  heroBadge: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderRadius: 20 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  heroBadgeText: { fontSize: 11, fontWeight: '700' },
  heroTitle: { color: '#ffffff', fontSize: 24, lineHeight: 32, fontWeight: '700' },
  heroBody: { color: '#d5e9df', fontSize: 13, lineHeight: 20, marginTop: 5 },
  refreshButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 12,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#608579',
    borderRadius: 10,
  },
  refreshGlyph: { color: '#ffffff', fontSize: 19, lineHeight: 21 },
  refreshText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  pressed: { opacity: 0.76 },
  disabled: { opacity: 0.6 },
  statusSection: { gap: 12 },
  sectionTitle: { color: '#172b27', fontSize: 15, fontWeight: '700' },
  statusList: { borderRadius: 14, backgroundColor: '#ffffff', paddingHorizontal: 16 },
  statusRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowReverse: { flexDirection: 'row-reverse' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  statusValue: { maxWidth: '54%', fontSize: 12, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#e1e9e4' },
  metrics: { flexDirection: 'row', gap: 10 },
  metric: { flex: 1, minWidth: 0, minHeight: 70, justifyContent: 'center', paddingHorizontal: 13, borderWidth: 1, borderRadius: 12 },
  metricLabel: { fontSize: 11 },
  metricValue: { fontSize: 15, fontWeight: '700', marginTop: 5 },
  preferencesSection: { gap: 11 },
  controlLabel: { color: '#61736c', fontSize: 12, fontWeight: '600', marginTop: 3 },
  segment: { flexDirection: 'row', gap: 8 },
  choice: { flex: 1, minHeight: 42, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8, borderWidth: 1, borderRadius: 9 },
  choiceText: { fontSize: 12, fontWeight: '600' },
  urlInput: { minHeight: 46, borderWidth: 1, borderColor: '#d5e0da', borderRadius: 10, paddingHorizontal: 12, color: '#172b27', backgroundColor: '#ffffff', fontSize: 13 },
  hint: { color: '#61736c', fontSize: 11, lineHeight: 16, textAlign: 'left' },
  saveButton: { minHeight: 44, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0c5949', borderRadius: 10 },
  saveButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  footer: { color: '#61736c', fontSize: 11, textAlign: 'center', marginTop: 1 },
});
