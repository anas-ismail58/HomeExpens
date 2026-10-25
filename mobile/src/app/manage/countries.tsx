import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import { addCountry, COUNTRY_CODES, removeCountry, setDefaultCountry } from '../../api';
import { Card, InlineDelete, ListSkeleton } from '../../components';
import { useCountries } from '../../countries';
import { countryFlag, useCountryName } from '../../CountrySwitcher';
import { Chips, Field } from '../../formControls';
import { ListPage, useRowStyles } from '../../manageUi';
import { usePreferences, useStyles } from '../../preferences';
import { useAuthedSession } from '../../SessionContext';
import { Text } from '../../typography';

/** The countries the family spends in: add, choose the default, remove. Father only. */
export default function CountriesPage() {
  const { session, call } = useAuthedSession();
  const { t } = usePreferences();
  const { countries, reload } = useCountries();
  const name = useCountryName();
  const s = useRowStyles();
  const x = useStyles((c, d) => ({
    badge: { color: c.primary, fontSize: 12, fontWeight: '800' as const, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: c.primarySoft, overflow: 'hidden' as const },
    link: { color: c.primary, fontSize: 13, fontWeight: '700' as const, textAlign: d.start },
  }));
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void reload().finally(() => setLoaded(true));
  }, [reload]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      setError('');
      try {
        await action();
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : t('saveError'));
      } finally {
        setBusy(false);
      }
    },
    [reload, t],
  );

  const available = COUNTRY_CODES.filter((code) => !countries.some((c) => c.code === code));
  return (
    <ListPage allowed={session.user.isAdmin} hint={t('countriesHint')} error={error}>
      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        {!loaded && !countries.length ? <ListSkeleton rows={2} /> : countries.map((country, index) => (
          <View key={country.id} style={[s.row, index > 0 && s.divider]}>
            <RNText style={{ fontSize: 26 }}>{countryFlag(country.code)}</RNText>
            <View style={s.info}>
              <Text style={s.title}>{name(country)}</Text>
              <Text style={s.sub}>{country.currency}</Text>
            </View>
            {country.isDefault ? (
              <Text style={x.badge}>{t('defaultCountry')}</Text>
            ) : (
              <View style={s.actions}>
                <Pressable disabled={busy} onPress={() => void run(() => call((sess, r) => setDefaultCountry(sess, country.id, r)))} accessibilityRole="button">
                  <Text style={x.link}>{t('makeDefault')}</Text>
                </Pressable>
                <InlineDelete label={name(country)} onConfirm={() => run(() => call((sess, r) => removeCountry(sess, country.id, r)))} />
              </View>
            )}
          </View>
        ))}
      </Card>
      {available.length ? (
        <Card>
          <Field label={t('addCountry')}>
            <Chips
              options={available.map((code) => ({ value: code, label: `${countryFlag(code)}  ${name({ code })}` }))}
              value={null}
              onChange={(code) => void run(() => call((sess, r) => addCountry(sess, code, r)))}
            />
          </Field>
        </Card>
      ) : null}
    </ListPage>
  );
}
