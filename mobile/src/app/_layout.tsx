import { Stack } from 'expo-router';
import { RootProviders, ThemedNavigation, useStackOptions } from '../RootShell';
import { usePreferences } from '../preferences';
import { useSession } from '../SessionContext';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function RootLayout() {
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
        <Stack.Screen name="teacher/[id]" options={{ title: t('teacherProfile') }} />
        <Stack.Screen name="manage/children" options={{ title: t('children') }} />
        <Stack.Screen name="manage/teachers" options={{ title: t('teachers') }} />
        <Stack.Screen name="manage/subjects" options={{ title: t('subjects') }} />
        <Stack.Screen name="manage/fees" options={{ title: t('monthlyFees') }} />
        <Stack.Screen name="manage/sections" options={{ title: t('householdSections') }} />
        <Stack.Screen name="manage/wallets" options={{ title: t('wallets') }} />
        <Stack.Screen name="manage/lessons" options={{ title: t('allLessonsTitle') }} />
        <Stack.Screen name="manage/transactions" options={{ title: t('allTransactionsTitle') }} />
        <Stack.Screen name="admin" options={{ title: t('adminPanel') }} />
      </Stack.Protected>
      <Stack.Screen name="reset-password" options={{ headerShown: false }} />
      <Stack.Protected guard={!session}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="join" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}
