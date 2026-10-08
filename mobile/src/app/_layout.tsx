import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PreferencesProvider, usePreferences } from '../preferences';
import { NotificationsProvider } from '../NotificationsContext';
import { SessionProvider, useSession } from '../SessionContext';
import { APP_FONTS, fontFace } from '../typography';
import { useAutoUpdates } from '../useAutoUpdates';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function RootLayout() {
  useAutoUpdates();
  // IBM Plex Sans + IBM Plex Sans Arabic. If loading fails the app still runs on system fonts.
  const [fontsLoaded, fontError] = useFonts(APP_FONTS);
  if (!fontsLoaded && !fontError) return null;
  return (
    <SafeAreaProvider>
      <PreferencesProvider>
        <SessionProvider>
          <NotificationsProvider>
            <ThemedRoot />
          </NotificationsProvider>
        </SessionProvider>
      </PreferencesProvider>
    </SafeAreaProvider>
  );
}

function ThemedRoot() {
  const { session, ready } = useSession();
  const { colors, scheme, t, language } = usePreferences();
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
      <Stack
        screenOptions={{
          headerTintColor: colors.primary,
          headerTitleStyle: { color: colors.text, fontFamily: fontFace('700', arabic) },
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Protected guard={Boolean(session)}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="expense/[id]" options={{ title: t('expenseDetails') }} />
          <Stack.Screen name="child/[id]" options={{ title: t('child') }} />
          <Stack.Screen name="create/[kind]" options={{ title: t('create') }} />
          <Stack.Screen name="payment/[id]" options={{ title: t('paymentDetails') }} />
          <Stack.Screen name="payment/new" options={{ title: t('newPayment') }} />
          <Stack.Screen name="notifications" options={{ title: t('notifications') }} />
          <Stack.Screen name="family/index" options={{ title: t('familyAndPermissions') }} />
          <Stack.Screen name="family/permissions" options={{ title: t('familyPermissions') }} />
          <Stack.Screen name="profile" options={{ title: t('profile') }} />
          <Stack.Screen name="salary" options={{ title: t('salaryBudget') }} />
          <Stack.Screen name="private" options={{ title: t('privateMoney') }} />
          <Stack.Screen name="wallet/new" options={{ title: t('newWallet') }} />
          <Stack.Screen name="wallet/[id]" options={{ title: t('wallets') }} />
          <Stack.Screen name="admin" options={{ title: t('adminPanel') }} />
        </Stack.Protected>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="join" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
