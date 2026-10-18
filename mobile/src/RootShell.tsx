import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PreferencesProvider, usePreferences } from './preferences';
import { NotificationsProvider } from './NotificationsContext';
import { SessionProvider, useSession } from './SessionContext';
import { APP_FONTS, fontFace } from './typography';
import { useAutoUpdates } from './useAutoUpdates';

/** Fonts, updates and providers shared by both apps (home expenses and kids' points). */
export function RootProviders({ children }: { children: ReactNode }) {
  useAutoUpdates();
  // IBM Plex Sans + IBM Plex Sans Arabic. If loading fails the app still runs on system fonts.
  const [fontsLoaded, fontError] = useFonts(APP_FONTS);
  if (!fontsLoaded && !fontError) return null;
  return (
    <SafeAreaProvider>
      <PreferencesProvider>
        <SessionProvider>
          <NotificationsProvider>{children}</NotificationsProvider>
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

/** Header look shared by every stack screen. */
export function useStackOptions() {
  const { colors, language } = usePreferences();
  const arabic = language === 'ar';
  return useMemo(() => ({
    headerTintColor: colors.primary,
    headerTitleStyle: { color: colors.text, fontFamily: fontFace('700', arabic) },
    headerStyle: { backgroundColor: colors.background },
    headerShadowVisible: false,
    contentStyle: { backgroundColor: colors.background },
    headerBackButtonDisplayMode: 'minimal' as const,
  }), [arabic, colors]);
}
