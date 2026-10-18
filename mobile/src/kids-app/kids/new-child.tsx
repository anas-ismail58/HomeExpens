import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { addChild } from '../../api';
import { Card, EmptyState, PrimaryButton } from '../../components';
import { Field, TextField } from '../../formControls';
import { WithKidsBar } from '../../kidsShell';
import { usePreferences, useStyles } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';
import { Text } from '../../typography';

export default function NewChildPage() {
  return (
    <WithKidsBar>
      <NewChildScreen />
    </WithKidsBar>
  );
}

/** Add a child to the family; the same child appears in the home expenses app too. */
function NewChildScreen() {
  const { call } = useAuthedSession();
  const { t } = usePreferences();
  const can = useCan();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 32, gap: 14 },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  if (!can('MANAGE_CHILDREN')) return <EmptyState icon="lock-closed-outline" title={t('noAccess')} body={t('noAccessBody')} />;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const child = await call((sess, r) => addChild(sess, { name: name.trim() }, r));
      router.replace(`/kids/${child.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: 12 }}>
        <Field label={t('childName')}>
          <TextField value={name} onChange={setName} placeholder={t('childNamePlaceholder')} />
        </Field>
        {error ? <Text style={s.error}>{error}</Text> : null}
        <PrimaryButton label={t('svcChild')} icon="person-add" busy={busy} disabled={name.trim().length < 2} onPress={() => void save()} />
      </Card>
    </ScrollView>
  );
}
