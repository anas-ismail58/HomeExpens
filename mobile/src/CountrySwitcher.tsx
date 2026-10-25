import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import type { Country } from './api';
import { useCountries } from './countries';
import type { StringKey } from './i18n';
import { usePreferences, useStyles } from './preferences';
import { useSession } from './SessionContext';
import { Text } from './typography';

/** The flag emoji of a country code (EU → the EU flag). */
export function countryFlag(code: string) {
  return String.fromCodePoint(...[...code.toUpperCase()].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

export function useCountryName() {
  const { t } = usePreferences();
  return (country: Pick<Country, 'code'>) => t(`country_${country.code}` as StringKey);
}

/**
 * Chips to switch between the family's countries (and "all countries", combined in the family currency).
 * Hidden while the family has only one country; the father then adds more from the More menu.
 */
export function CountrySwitcher() {
  const { t, colors } = usePreferences();
  const { session } = useSession();
  const { countries, selected, select } = useCountries();
  const name = useCountryName();
  const s = useStyles((c, d) => ({
    row: { flexDirection: d.row, gap: 8, paddingVertical: 2 },
    chip: { minHeight: 40, flexDirection: d.row, alignItems: 'center' as const, gap: 6, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
    active: { borderColor: c.primary, backgroundColor: c.primarySoft },
    text: { color: c.textSecondary, fontSize: 13, fontWeight: '700' as const },
    activeText: { color: c.primary },
    currency: { color: c.muted, fontSize: 11, fontWeight: '700' as const },
  }));
  if (countries.length < 2) return null;
  const chip = (key: string, label: string, sub: string, icon: React.ReactNode) => {
    const active = selected === key;
    return (
      <Pressable key={key} onPress={() => select(key)} style={({ pressed }) => [s.chip, active && s.active, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityState={{ selected: active }}>
        {icon}
        <Text style={[s.text, active && s.activeText]}>{label}</Text>
        <Text style={s.currency}>{sub}</Text>
      </Pressable>
    );
  };
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
      {chip('all', t('allCountries'), session?.family.currency ?? '', <Ionicons name="earth" size={16} color={selected === 'all' ? colors.primary : colors.muted} />)}
      {countries.map((country) => chip(country.id, name(country), country.currency, <Text style={{ fontSize: 16 }}>{countryFlag(country.code)}</Text>))}
      {session?.user.isAdmin ? (
        <Pressable onPress={() => router.push('/manage/countries')} style={({ pressed }) => [s.chip, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={t('countries')}>
          <Ionicons name="settings-outline" size={16} color={colors.muted} />
        </Pressable>
      ) : null}
      <View style={{ width: 4 }} />
    </ScrollView>
  );
}
