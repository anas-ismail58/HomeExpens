import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { createWallet, getMembers, type FamilyMember } from '../../api';
import { WithBottomBar } from '../../BottomBar';
import { Card, EmptyState, PrimaryButton } from '../../components';
import { Chips, Field, MultiChips, normalizeDigits, TextField } from '../../formControls';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession } from '../../SessionContext';
import { Text } from '../../typography';

const AMOUNT = /^\d{1,11}(\.\d{1,3})?$/;

export default function NewWalletPage() {
  return (
    <WithBottomBar>
      <NewWalletScreen />
    </WithBottomBar>
  );
}

/** The father gives someone an allowance and chooses who may deduct from it. */
function NewWalletScreen() {
  const { session, call } = useAuthedSession();
  const { t } = usePreferences();
  const format = useFormat();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [name, setName] = useState('');
  const [holderId, setHolderId] = useState('');
  const [amount, setAmount] = useState('');
  const [spenderIds, setSpenderIds] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    call((s, r) => getMembers(s, r)).then((list) => active && setMembers(list)).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [call]);

  // By default the person who receives it is the one who deducts from it.
  const spenders = spenderIds ?? (holderId ? [holderId] : []);
  const value = normalizeDigits(amount);
  const validAmount = !value || (AMOUNT.test(value) && Number(value) > 0);
  const canSave = name.trim().length > 0 && Boolean(holderId) && validAmount && spenders.length > 0;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const wallet = await call((s, r) => createWallet(s, { name: name.trim(), holderId, amount: value || undefined, spenderIds: spenders }, r));
      router.replace(`/wallet/${wallet.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
      setSaving(false);
    }
  };

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 16 },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  if (!session.user.isAdmin) {
    return (
      <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
        <EmptyState icon="lock-closed-outline" title={t('noAccess')} body={t('noAccessBody')} />
      </View>
    );
  }

  const people = members.map((m) => ({ value: m.id, label: m.id === session.user.id ? `${m.name} (${t('you')})` : m.name }));
  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: 16 }}>
          <Field label={t('walletName')}>
            <TextField value={name} onChange={setName} placeholder={t('walletNamePlaceholder')} />
          </Field>
          <Field label={t('walletHolder')}>
            <Chips options={people.map((p) => ({ ...p, icon: 'person' as const }))} value={holderId || null} onChange={setHolderId} />
          </Field>
          <Field label={`${t('walletAmount')} · ${session.family.currency}`}>
            <TextField value={amount} onChange={setAmount} keyboardType="decimal-pad" placeholder={format.number(0)} />
          </Field>
          <Field label={t('walletSpenders')}>
            <MultiChips options={people} values={spenders} onChange={setSpenderIds} />
          </Field>
        </Card>
        {error ? <Text style={s.error}>{error}</Text> : null}
        <PrimaryButton label={t('save')} icon="checkmark" onPress={() => void save()} disabled={!canSave} busy={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
