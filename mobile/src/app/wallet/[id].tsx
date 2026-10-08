import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import {
  ApiError,
  closeWallet,
  deleteWalletEntry,
  getHouseholdSections,
  getMembers,
  getWallet,
  spendFromWallet,
  topUpWallet,
  updateWallet,
  type FamilyMember,
  type HouseholdSection,
  type WalletDetails,
} from '../../api';
import { WithBottomBar } from '../../BottomBar';
import { Card, ConfirmDeleteButton, EmptyState, GradientHero, IconBubble, InlineDelete, ListSkeleton, PrimaryButton, SectionTitle, Skeleton } from '../../components';
import { Chips, Field, MultiChips, normalizeDigits, TextField } from '../../formControls';
import { CountUp, FadeInView } from '../../motion';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession } from '../../SessionContext';
import { Text } from '../../typography';

const AMOUNT = /^\d{1,11}(\.\d{1,3})?$/;

export default function WalletPage() {
  return (
    <WithBottomBar>
      <WalletScreen />
    </WithBottomBar>
  );
}

function WalletScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, call } = useAuthedSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const [wallet, setWallet] = useState<WalletDetails | null>(null);
  const [sections, setSections] = useState<HouseholdSection[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [spendAmount, setSpendAmount] = useState('');
  const [spendNote, setSpendNote] = useState('');
  const [sectionKey, setSectionKey] = useState('');
  const [topAmount, setTopAmount] = useState('');
  const [spenderIds, setSpenderIds] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<'spend' | 'top' | 'spenders' | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await call((s, r) => getWallet(s, id, r));
      setWallet(next);
      setError('');
      call(getHouseholdSections).then(setSections).catch(() => undefined);
      if (next.canManage) call((s, r) => getMembers(s, r)).then(setMembers).catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [call, id, t]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const run = async (kind: 'spend' | 'top' | 'spenders', action: () => Promise<WalletDetails>, done?: () => void) => {
    setBusy(kind);
    setError('');
    setNotice('');
    try {
      setWallet(await action());
      done?.();
      setNotice(t('saved'));
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'INSUFFICIENT_BALANCE' ? t('insufficientBalance') : err instanceof Error ? err.message : t('saveError'));
    } finally {
      setBusy(null);
    }
  };

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 16 },
    heroLabel: { color: c.heroMuted, fontSize: 13, fontWeight: '600' as const, textAlign: d.start },
    heroAmount: { color: c.heroText, fontSize: 34, fontWeight: '800' as const, textAlign: d.start, marginTop: 4, fontVariant: ['tabular-nums' as const] },
    heroSub: { color: c.heroMuted, fontSize: 12, textAlign: d.start, marginTop: 2 },
    split: { flexDirection: d.row, gap: 10, marginTop: 14 },
    chip: { flex: 1, minWidth: 0, borderRadius: 14, padding: 12, backgroundColor: 'rgba(255,255,255,0.16)' },
    chipLabel: { color: c.heroMuted, fontSize: 12, textAlign: d.start },
    chipValue: { color: c.heroText, fontSize: 15, fontWeight: '700' as const, marginTop: 4, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    hint: { color: c.muted, fontSize: 12, lineHeight: 18, textAlign: d.start },
    row: { minHeight: 56, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 8 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    rowLabel: { color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.start },
    rowSub: { color: c.muted, fontSize: 12, textAlign: d.start, marginTop: 2 },
    rowValue: { fontSize: 14, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    notice: { color: c.success, fontSize: 13, fontWeight: '700' as const, textAlign: d.start },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  if (loading) {
    return (
      <View style={[s.screen, s.page]}>
        <Skeleton height={160} radius={24} />
        <Card><ListSkeleton rows={3} /></Card>
      </View>
    );
  }
  if (!wallet) {
    return (
      <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
        <EmptyState icon="alert-circle-outline" title={t('wallets')} body={error || t('loadError')} />
      </View>
    );
  }

  const currency = wallet.currency;
  const spendValue = normalizeDigits(spendAmount);
  const topValue = normalizeDigits(topAmount);
  const validSpend = AMOUNT.test(spendValue) && Number(spendValue) > 0;
  const validTop = AMOUNT.test(topValue) && Number(topValue) > 0;
  const spendersDraft = spenderIds ?? wallet.spenders.map((p) => p.id);
  const balance = Number(wallet.balance);

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      style={s.screen}
      contentContainerStyle={s.page}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
    >
      <Stack.Screen options={{ title: wallet.name }} />
      <GradientHero>
        <Text style={s.heroLabel}>{t('walletBalance')}</Text>
        <CountUp value={balance}>
          {(shown) => <Text style={[s.heroAmount, balance <= 0 && { color: '#ffd7d2' }]} numberOfLines={1} adjustsFontSizeToFit>{format.money(shown, currency)}</Text>}
        </CountUp>
        <Text style={s.heroSub}>{t('heldBy', { name: wallet.holder.name })}</Text>
        <View style={s.split}>
          <View style={s.chip}>
            <Text style={s.chipLabel}>{t('walletAdded')}</Text>
            <Text style={s.chipValue} numberOfLines={1}>{format.money(wallet.added, currency)}</Text>
          </View>
          <View style={s.chip}>
            <Text style={s.chipLabel}>{t('walletSpent')}</Text>
            <Text style={s.chipValue} numberOfLines={1}>{format.money(wallet.spent, currency)}</Text>
          </View>
        </View>
      </GradientHero>

      {notice ? <Text style={s.notice}>{notice}</Text> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}

      {wallet.canSpend ? (
        <FadeInView index={1} style={{ gap: 10 }}>
          <SectionTitle title={t('deduct')} />
          <Card style={{ gap: 12 }}>
            <Field label={`${t('amount')} · ${currency}`}>
              <TextField value={spendAmount} onChange={setSpendAmount} keyboardType="decimal-pad" placeholder={format.number(0)} />
            </Field>
            <Field label={t('optionalNote')}>
              <TextField value={spendNote} onChange={setSpendNote} placeholder={t('notePlaceholder')} />
            </Field>
            {sections.length ? (
              <Field label={t('section')}>
                <Chips options={[{ value: '', label: t('none') }, ...sections.map((x) => ({ value: x.key ?? x.id, label: format.name(x) }))]} value={sectionKey} onChange={setSectionKey} />
              </Field>
            ) : null}
            <Text style={s.hint}>{t('deductHint')}</Text>
            <PrimaryButton
              label={t('deduct')}
              icon="remove-circle-outline"
              busy={busy === 'spend'}
              disabled={!validSpend || Number(spendValue) > balance}
              onPress={() =>
                void run('spend', () => call((sess, r) => spendFromWallet(sess, wallet.id, { amount: spendValue, note: spendNote.trim() || undefined, sectionKey: sectionKey || undefined }, r)), () => {
                  setSpendAmount('');
                  setSpendNote('');
                })
              }
            />
            {validSpend && Number(spendValue) > balance ? <Text style={s.error}>{t('insufficientBalance')}</Text> : null}
          </Card>
        </FadeInView>
      ) : null}

      {wallet.canManage ? (
        <FadeInView index={2} style={{ gap: 10 }}>
          <SectionTitle title={t('addMoney')} />
          <Card style={{ gap: 12 }}>
            <Field label={`${t('amount')} · ${currency}`}>
              <TextField value={topAmount} onChange={setTopAmount} keyboardType="decimal-pad" placeholder={format.number(0)} />
            </Field>
            <PrimaryButton
              label={t('addMoney')}
              icon="add-circle-outline"
              busy={busy === 'top'}
              disabled={!validTop}
              onPress={() => void run('top', () => call((sess, r) => topUpWallet(sess, wallet.id, { amount: topValue }, r)), () => setTopAmount(''))}
            />
          </Card>
        </FadeInView>
      ) : null}

      <FadeInView index={3} style={{ gap: 10 }}>
        <SectionTitle title={t('walletHistory')} count={wallet.entries.length} />
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          {wallet.entries.length ? wallet.entries.map((entry, index) => {
            const incoming = entry.type === 'TOPUP';
            return (
              <View key={entry.id} style={[s.row, index > 0 && s.divider]}>
                <IconBubble name={incoming ? 'arrow-down' : 'arrow-up'} color={incoming ? colors.success : colors.danger} background={incoming ? colors.successSoft : colors.dangerSoft} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={s.rowLabel} numberOfLines={1}>{entry.note || (incoming ? t('addMoney') : t('deduct'))}</Text>
                  <Text style={s.rowSub}>{[format.date(entry.date), entry.createdBy?.name].filter(Boolean).join(' · ')}</Text>
                </View>
                <Text style={[s.rowValue, { color: incoming ? colors.success : colors.danger }]}>
                  {incoming ? '+' : '−'}{format.money(entry.amount, currency)}
                </Text>
                {entry.canDelete ? (
                  <InlineDelete
                    label={entry.note ?? ''}
                    onConfirm={async () => {
                      try {
                        setWallet(await call((sess, r) => deleteWalletEntry(sess, wallet.id, entry.id, r)));
                      } catch (err) {
                        setError(err instanceof ApiError && err.code === 'INSUFFICIENT_BALANCE' ? t('insufficientBalance') : err instanceof Error ? err.message : t('deleteError'));
                      }
                    }}
                  />
                ) : null}
              </View>
            );
          }) : <Text style={[s.hint, { paddingVertical: 14 }]}>{t('noWalletEntries')}</Text>}
        </Card>
      </FadeInView>

      {wallet.canManage ? (
        <View style={{ gap: 10 }}>
          <SectionTitle title={t('walletSpenders')} />
          <Card style={{ gap: 12 }}>
            <MultiChips
              options={members.map((m) => ({ value: m.id, label: m.id === session.user.id ? `${m.name} (${t('you')})` : m.name }))}
              values={spendersDraft}
              onChange={setSpenderIds}
            />
            {spenderIds ? (
              <PrimaryButton
                label={t('saveChanges')}
                icon="checkmark"
                busy={busy === 'spenders'}
                disabled={!spendersDraft.length}
                onPress={() => void run('spenders', () => call((sess, r) => updateWallet(sess, wallet.id, { spenderIds: spendersDraft }, r)), () => setSpenderIds(null))}
              />
            ) : null}
          </Card>
          <ConfirmDeleteButton
            label={t('closeWallet')}
            question={t('closeWalletQuestion')}
            onConfirm={async () => {
              await call((sess, r) => closeWallet(sess, wallet.id, r));
              if (router.canGoBack()) router.back();
              else router.replace('/services');
            }}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}
