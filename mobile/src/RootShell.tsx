import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, ThemeProvider, type NativeStackHeaderProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Updates from 'expo-updates';
import { useMemo, type ReactNode } from 'react';
import { ActivityIndicator, I18nManager, Platform, Pressable, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { PreferencesProvider, usePreferences, useStyles } from './preferences';
import { NotificationsProvider } from './NotificationsContext';
import { SessionProvider, useSession } from './SessionContext';
import { appFonts, fontFace, Text } from './typography';
import { CountryProvider } from './countries';
import { useAutoUpdates } from './useAutoUpdates';

// The app lays Arabic out right-to-left itself (see direction() in theme.ts). A phone set to Arabic must not
// mirror it a second time, which would turn every row back to left-to-right. Android allows that by default.
if (Platform.OS !== 'web') {
  const mirrored = I18nManager.isRTL;
  I18nManager.allowRTL(false);
  I18nManager.forceRTL(false);
  // The setting applies from the next launch; restart once so this launch is already right.
  if (mirrored) void Updates.reloadAsync().catch(() => undefined);
}

/** Fonts, updates and providers shared by both apps (home expenses and kids' points). */
export function RootProviders({ children }: { children: ReactNode }) {
  useAutoUpdates();
  // IBM Plex Sans + IBM Plex Sans Arabic (Baloo Bhaijaan 2 in the kids app). If loading fails the app still runs on system fonts.
  const [fontsLoaded, fontError] = useFonts(appFonts());
  if (!fontsLoaded && !fontError) return null;
  return (
    <SafeAreaProvider>
      <PreferencesProvider>
        <SessionProvider>
          <CountryProvider>
            <NotificationsProvider>{children}</NotificationsProvider>
          </CountryProvider>
        </SessionProvider>
      </PreferencesProvider>
    </SafeAreaProvider>
  );
}

/** Navigation theme, status bar and a spinner until the saved session is restored. */
export function ThemedNavigation({ children }: { children: ReactNode }) {
  const { ready } = useSession();
  const { colors, scheme, language } = usePreferences();
  const arabic = language === 'ar';

  const navigationTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    const face = (weight: '400' | '500' | '700') => ({ fontFamily: fontFace(weight, arabic), fontWeight: 'normal' as const });
    return {
      ...base,
      colors: { ...base.colors, primary: colors.primary, background: colors.background, card: colors.surface, text: colors.text, border: colors.border },
      fonts: { regular: face('400'), medium: face('500'), bold: face('700'), heavy: face('700') },
    };
  }, [arabic, colors, scheme]);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {children}
    </ThemeProvider>
  );
}

/**
 * Page header for every stack screen. Built here rather than by the native stack so it follows the app's
 * language: in Arabic the back arrow and title sit on the right and the arrow points right; the screen's
 * own header button (e.g. "Edit") goes to the opposite side.
 */
function StackHeader({ options, route, navigation, back }: NativeStackHeaderProps) {
  const { colors, rtl, t } = usePreferences();
  const insets = useSafeAreaInsets();
  const s = useStyles((c, d) => ({
    bar: { paddingTop: insets.top, backgroundColor: c.background },
    row: { minHeight: 52, flexDirection: d.row, alignItems: 'center' as const, gap: 6, paddingHorizontal: 10 },
    back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center' as const, justifyContent: 'center' as const },
    title: { flex: 1, color: c.text, fontSize: 18, fontWeight: '700' as const, textAlign: d.start, paddingHorizontal: back ? 0 : 8 },
  }));
  const title = typeof options.title === 'string' ? options.title : route.name;
  const action = options.headerRight?.({ tintColor: colors.primary, canGoBack: Boolean(back) });
  return (
    <View style={s.bar}>
      <View style={s.row}>
        {back ? (
          <Pressable onPress={() => navigation.goBack()} style={({ pressed }) => [s.back, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={t('back')} hitSlop={8}>
            <Ionicons name={rtl ? 'arrow-forward' : 'arrow-back'} size={24} color={colors.primary} />
          </Pressable>
        ) : null}
        <Text style={s.title} numberOfLines={1}>{title}</Text>
        {action ? <View>{action}</View> : null}
      </View>
    </View>
  );
}

/** Header look shared by every stack screen. */
export function useStackOptions() {
  const { colors } = usePreferences();
  return useMemo(() => ({
    header: (props: NativeStackHeaderProps) => <StackHeader {...props} />,
    contentStyle: { backgroundColor: colors.background },
  }), [colors]);
}
