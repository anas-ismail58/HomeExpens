import { Stack } from 'expo-router';
import { markKidsApp } from '../appVariant';
import { RootProviders, ThemedNavigation, useStackOptions } from '../RootShell';
import { usePreferences } from '../preferences';
import { useSession } from '../SessionContext';

markKidsApp();

export const unstable_settings = { initialRouteName: 'kids/index' };

/** The kids' points app: same accounts and server as home expenses, only the points pages. */
export default function KidsRootLayout() {
  return (
    <RootProviders>
      <ThemedNavigation>
        <Screens />
      </ThemedNavigation>
    </RootProviders>
  );
}

function Screens() {
  const { session } = useSession();
  const { t } = usePreferences();
  const screenOptions = useStackOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Protected guard={Boolean(session)}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="kids/index" options={{ headerShown: false }} />
        <Stack.Screen name="kids/[id]" options={{ title: t('kidsPoints') }} />
        <Stack.Screen name="kids/act" options={{ title: t('kidsPoints') }} />
        <Stack.Screen name="kids/report" options={{ title: t('kReports') }} />
        <Stack.Screen name="kids/day" options={{ title: t('kDayByDay') }} />
        <Stack.Screen name="kids/settings" options={{ title: t('kSettings') }} />
        <Stack.Screen name="kids/audit" options={{ title: t('kAudit') }} />
        <Stack.Screen name="kids/services" options={{ headerShown: false }} />
        <Stack.Screen name="kids/permissions" options={{ title: t('kPermissions') }} />
        <Stack.Screen name="kids/new-child" options={{ title: t('svcChild') }} />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="join" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}
