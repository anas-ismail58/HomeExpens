import { useState } from 'react';
import { ScrollView } from 'react-native';
import { Text } from '../typography';
import { updateProfile } from '../api';
import { WithBottomBar } from '../BottomBar';
import { Card, GradientHero, PrimaryButton } from '../components';
import { Chips, Field, TextField } from '../formControls';
import type { StringKey } from '../i18n';
import { useNotifications } from '../NotificationsContext';
import { usePreferences, useStyles } from '../preferences';
import { useAuthedSession } from '../SessionContext';

const COMMON_ZONES = ['Asia/Riyadh', 'Africa/Cairo', 'Asia/Dubai', 'Asia/Kuwait', 'Asia/Qatar', 'Europe/London'];

export default function ProfilePage() {
  return (
    <WithBottomBar>
      <ProfileScreen />
    </WithBottomBar>
  );
}

function ProfileScreen() {
  const { session, call, setSession } = useAuthedSession();
  const { t } = usePreferences();
  const { syncDevice } = useNotifications();
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = [...new Set([session.user.timezone, deviceZone, ...COMMON_ZONES].filter(Boolean))];
  const [name, setName] = useState(session.user.name);
  const [timezone, setTimezone] = useState(session.user.timezone);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      const account = await call((s, r) => updateProfile(s, { name: name.trim(), timezone }, r));
      setSession({ ...session, ...account });
      void syncDevice().catch(() => undefined);
      setMessage(t('saved'));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('saveError'));
    } finally {
      setSaving(false);
    }
  };

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 16 },
    heroName: { color: c.heroText, fontSize: 20, fontWeight: '800' as const, textAlign: d.start },
    heroSub: { color: c.heroMuted, fontSize: 13, marginTop: 4, textAlign: d.start },
    message: { color: c.textSecondary, fontSize: 13, textAlign: d.start },
  }));

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <GradientHero>
        <Text style={s.heroName}>{session.user.name}</Text>
        <Text style={s.heroSub}>{t(`role${session.user.role}` as StringKey)} · {session.family.name}</Text>
        <Text style={s.heroSub}>{session.user.email}</Text>
      </GradientHero>
      <Card style={{ gap: 16 }}>
        <Field label={t('yourName')}>
          <TextField value={name} onChange={setName} />
        </Field>
        <Field label={t('yourTimezone')} hint={`${t('timezoneHint')} ${t('deviceTimezone', { zone: deviceZone })}`}>
          <Chips options={zones.map((zone) => ({ value: zone, label: zone.replace('_', ' ') }))} value={timezone} onChange={setTimezone} />
        </Field>
      </Card>
      {message ? <Text style={s.message}>{message}</Text> : null}
      <PrimaryButton label={t('save')} icon="checkmark" onPress={() => void save()} busy={saving} disabled={name.trim().length < 2} />
    </ScrollView>
  );
}
