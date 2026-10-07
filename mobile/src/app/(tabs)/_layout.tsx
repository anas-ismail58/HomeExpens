import { Tabs } from 'expo-router';
import { BottomBar } from '../../BottomBar';
import { usePreferences } from '../../preferences';

export default function TabsLayout() {
  const { colors, t } = usePreferences();
  return (
    <Tabs
      initialRouteName="index"
      tabBar={() => <BottomBar />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabHome') }} />
      <Tabs.Screen name="services" options={{ title: t('tabServices') }} />
      <Tabs.Screen name="payments" options={{ title: t('tabPayments') }} />
      <Tabs.Screen name="analytics" options={{ title: t('tabAnalytics') }} />
    </Tabs>
  );
}
