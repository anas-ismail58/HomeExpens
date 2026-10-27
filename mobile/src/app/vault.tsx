import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import {
  addVaultEntry,
  ApiError,
  CURRENCIES,
  deleteVaultEntry,
  forgetVaultDevice,
  getVault,
  trustVaultDevice,
  unlockVault,
  type Vault,
  type VaultSource,
} from '../api';
import { WithBottomBar } from '../BottomBar';
import { Card, EmptyState, GradientHero, IconBubble, InlineDelete, PrimaryButton, SectionTitle, SegmentedControl } from '../components';
import { useCountries } from '../countries';
import { Chips, Field, normalizeDigits, TextField, ToggleRow } from '../formControls';
import { useFormat, usePreferences, useStyles } from '../preferences';
import { useAuthedSession } from '../SessionContext';
import { Text, TextInput } from '../typography';
import { biometricKind, confirmWithBiometrics, forgetDeviceKey, readDeviceKey, saveDeviceKey, trustedDeviceId } from '../vaultAuth';

const AMOUNT = /^\d{1,11}(\.\d{1,3})?$/;
const MASK = '••••••';

export default function VaultPage() {
  return (
    <WithBottomBar>
      <VaultScreen />
    </WithBottomBar>
  );
}

/**
 * The member's own savings vault: money set aside, apart from what the family spends. It opens with Face ID
 * / fingerprint on a trusted phone, or the account password, and locks again when leaving the screen.
 */
function VaultScreen() {
  const { session, call } = useAuthedSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const { inputCurrency } = useCountries();
  const userId = session.user.id;
  const [token, setToken] = useState<{ value: string; expiresAt: number } | null>(null);
  const [vault, setVault] = useState<Vault | null>(null);
  const [password, setPassword] = useState('');
  const [bio, setBio] = useState<'face' | 'fingerprint' | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [direction, setDirection] = useState<'DEPOSIT' | 'WITHDRAW'>('DEPOSIT');
  const [amount, setAmount] = useState('');
  const [pickedCurrency, setCurrency] = useState<string | null>(null);
  const currency = pickedCurrency ?? inputCurrency;
  const [note, setNote] = useState('');
  // Where the money comes from (deposit) or goes back to (withdrawal); not the salary unless chosen.
  const [source, setSource] = useState<VaultSource>('OTHER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const triedBiometric = useRef(false);

  const lock = useCallback(() => {
    setToken(null);
    setVault(null);
    setVisible(false);
    setPassword('');
    triedBiometric.current = false;
  }, []);

  // Leaving the screen locks the vault; coming back asks again.
  useFocusEffect(useCallback(() => lock, [lock]));
  // The unlock lasts 10 minutes on the server; lock here when it runs out.
  useEffect(() => {
    if (!token) return;
    const timer = setTimeout(lock, Math.max(0, token.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [lock, token]);

  useEffect(() => {
    void biometricKind().then(setBio);
    void trustedDeviceId(userId).then(setDeviceId);
  }, [userId]);

  const opened = useCallback(
    async (unlock: { token: string; expiresAt: string }) => {
      setToken({ value: unlock.token, expiresAt: new Date(unlock.expiresAt).getTime() });
      setVault(await call((s, r) => getVault(s, unlock.token, r)));
      setPassword('');
      setError('');
    },
    [call],
  );

  const failed = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.code === 'VAULT_LOCKED') lock();
      setError(
        err instanceof ApiError && err.code === 'VAULT_WRONG_PASSWORD'
          ? t('vaultWrongPassword')
          : err instanceof ApiError && err.code === 'PRIVATE_INSUFFICIENT'
            ? t('vaultPrivateInsufficient')
            : err instanceof Error
              ? err.message
              : t('saveError'),
      );
    },
    [lock, t],
  );

  const openWithPassword = async () => {
    setBusy(true);
    try {
      await opened(await call((s, r) => unlockVault(s, { password }, r)));
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  const openWithBiometric = useCallback(async () => {
    const key = await readDeviceKey(userId, t('vaultBiometricPrompt'), t('cancel'));
    if (!key) return;
    setBusy(true);
    try {
      await opened(await call((s, r) => unlockVault(s, { deviceKey: key }, r)));
    } catch (err) {
      // The phone was removed from the trusted list (here or on another device): forget its key.
      if (err instanceof ApiError && err.code === 'VAULT_DEVICE_UNKNOWN') {
        await forgetDeviceKey(userId);
        setDeviceId(null);
      }
      failed(err);
    } finally {
      setBusy(false);
    }
  }, [call, failed, opened, t, userId]);

  // On a trusted phone, offer Face ID / fingerprint straight away.
  useEffect(() => {
    if (token || !bio || !deviceId || triedBiometric.current) return;
    triedBiometric.current = true;
    void openWithBiometric();
  }, [bio, deviceId, openWithBiometric, token]);

  const withToken = async (action: (value: string) => Promise<void>) => {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      await action(token.value);
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  const value = normalizeDigits(amount);
  const valid = AMOUNT.test(value) && Number(value) > 0;
  const save = () =>
    withToken(async (tok) => {
      setVault(await call((s, r) => addVaultEntry(s, tok, { direction, amount: value, currency, source, note: note.trim() || undefined }, r)));
      setAmount('');
      setNote('');
      setVisible(true);
    });

  const setBiometric = (on: boolean) =>
    withToken(async (tok) => {
      if (on) {
        // Face ID / fingerprint first, so it is really the owner turning it on.
        if (!(await confirmWithBiometrics(t('vaultBiometricPrompt'), t('cancel')))) {
          setError(t('vaultBiometricFailed'));
          return;
        }
        const device = await call((s, r) => trustVaultDevice(s, tok, Platform.OS === 'ios' ? 'iPhone' : 'Android', r));
        try {
          await saveDeviceKey(userId, device.id, device.deviceKey);
          setDeviceId(device.id);
        } catch {
          // The phone couldn't keep the key: don't leave an unused trusted entry behind, and say so.
          await call((s, r) => forgetVaultDevice(s, tok, device.id, r)).catch(() => undefined);
          setError(t('vaultBiometricFailed'));
        }
      } else if (deviceId) {
        await call((s, r) => forgetVaultDevice(s, tok, deviceId, r)).catch(() => undefined);
        await forgetDeviceKey(userId);
        setDeviceId(null);
      }
      setVault(await call((s, r) => getVault(s, tok, r)));
    });

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 18, width: '100%' as const, maxWidth: 720, alignSelf: 'center' as const },
    note: { color: c.textSecondary, fontSize: 13, lineHeight: 20, textAlign: d.start },
    lockIcon: { alignSelf: 'center' as const, width: 84, height: 84, borderRadius: 28, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.primarySoft, marginTop: 12 },
    lockTitle: { color: c.text, fontSize: 22, fontWeight: '800' as const, textAlign: 'center' as const },
    lockBody: { color: c.muted, fontSize: 14, lineHeight: 21, textAlign: 'center' as const },
    input: { minHeight: 52, borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingHorizontal: 14, color: c.text, backgroundColor: c.background, fontSize: 15, textAlign: d.start },
    heroTop: { flexDirection: d.row, alignItems: 'center' as const, gap: 8 },
    heroLabel: { flex: 1, color: c.heroMuted, fontSize: 13, fontWeight: '600' as const, textAlign: d.start },
    heroButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: 'rgba(255,255,255,0.2)' },
    heroAmount: { color: c.heroText, fontSize: 34, fontWeight: '800' as const, textAlign: d.start, marginTop: 6, fontVariant: ['tabular-nums' as const] },
    balances: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 8, marginTop: 14 },
    balance: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.14)' },
    balanceText: { color: c.heroText, fontSize: 13, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] },
    row: { minHeight: 56, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 8 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    rowLabel: { color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.start },
    rowSub: { color: c.muted, fontSize: 12, textAlign: d.start, marginTop: 2 },
    rowValue: { fontSize: 14, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] },
    hint: { color: c.muted, fontSize: 13, textAlign: d.start, paddingVertical: 10 },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  if (session.user.role === 'CHILD') {
    return (
      <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
        <EmptyState icon="lock-closed-outline" title={t('noAccess')} body={t('noAccessBody')} />
      </View>
    );
  }

  if (!token || !vault) {
    return (
      <ScrollView style={s.screen} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <View style={s.lockIcon}><Ionicons name="lock-closed" size={40} color={colors.primary} /></View>
        <Text style={s.lockTitle}>{t('vault')}</Text>
        <Text style={s.lockBody}>{t('vaultLockedBody')}</Text>
        {bio && deviceId ? (
          <PrimaryButton label={bio === 'face' ? t('vaultOpenFace') : t('vaultOpenFingerprint')} icon={bio === 'face' ? 'scan' : 'finger-print'} busy={busy} onPress={() => void openWithBiometric()} />
        ) : null}
        <Card style={{ gap: 12 }}>
          <Field label={t('vaultPassword')}>
            <TextInput value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} style={s.input} onSubmitEditing={() => password && void openWithPassword()} accessibilityLabel={t('vaultPassword')} />
          </Field>
          {error ? <Text style={s.error}>{error}</Text> : null}
          <PrimaryButton label={t('vaultOpen')} icon="lock-open" busy={busy} disabled={!password} onPress={() => void openWithPassword()} />
        </Card>
      </ScrollView>
    );
  }

  const money = (n: string | number, code: string) => (visible ? format.money(n, code) : MASK);
  return (
    <ScrollView showsVerticalScrollIndicator={false} style={s.screen} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Text style={s.note}>{t('vaultOnlyYou')}</Text>
      {error ? <Text style={s.error}>{error}</Text> : null}
      {/* Offer Face ID / fingerprint right away on a phone that has it and isn't trusted yet. */}
      {bio && !deviceId ? (
        <Card style={{ gap: 10 }}>
          <Text style={[s.rowLabel, { fontSize: 15 }]}>{bio === 'face' ? t('vaultUseFaceNext') : t('vaultUseFingerprintNext')}</Text>
          <PrimaryButton label={bio === 'face' ? t('vaultUseFace') : t('vaultUseFingerprint')} icon={bio === 'face' ? 'scan' : 'finger-print'} busy={busy} onPress={() => void setBiometric(true)} />
        </Card>
      ) : null}

      <GradientHero>
        <View style={s.heroTop}>
          <Text style={s.heroLabel}>{t('vaultTotal')}</Text>
          <Pressable onPress={() => setVisible((v) => !v)} style={s.heroButton} accessibilityLabel={visible ? t('hideAmounts') : t('showAmounts')}>
            <Ionicons name={visible ? 'eye-off' : 'eye'} size={20} color={colors.heroText} />
          </Pressable>
          <Pressable onPress={lock} style={s.heroButton} accessibilityLabel={t('vaultLock')}>
            <Ionicons name="lock-closed" size={18} color={colors.heroText} />
          </Pressable>
        </View>
        <Text style={s.heroAmount} numberOfLines={1} adjustsFontSizeToFit>{vault.total != null ? money(vault.total, vault.currency) : '—'}</Text>
        {vault.balances.length > 1 || (vault.balances[0] && vault.balances[0].currency !== vault.currency) ? (
          <View style={s.balances}>
            {vault.balances.map((b) => (
              <View key={b.currency} style={s.balance}><Text style={s.balanceText}>{money(b.amount, b.currency)}</Text></View>
            ))}
          </View>
        ) : null}
      </GradientHero>

      <Card style={{ gap: 14 }}>
        <SegmentedControl<'DEPOSIT' | 'WITHDRAW'> value={direction} onChange={setDirection} options={[{ value: 'DEPOSIT', label: t('vaultDeposit') }, { value: 'WITHDRAW', label: t('vaultWithdraw') }]} />
        <Field label={`${t('amount')} · ${currency}`}>
          <TextField value={amount} onChange={setAmount} keyboardType="decimal-pad" placeholder={format.number(0)} />
        </Field>
        <Field label={t('currency')}>
          <Chips options={CURRENCIES.map((code) => ({ value: code, label: code }))} value={currency} onChange={setCurrency} />
        </Field>
        <Field label={direction === 'DEPOSIT' ? t('vaultFrom') : t('vaultTo')}>
          <Chips
            options={[
              { value: 'SALARY' as const, label: direction === 'DEPOSIT' ? t('vaultSourceSalary') : t('vaultSourceSalaryBack'), icon: 'wallet' as const },
              ...(session.user.role === 'FATHER' ? [{ value: 'PRIVATE' as const, label: t('vaultSourcePrivate'), icon: 'lock-closed' as const }] : []),
              { value: 'OTHER' as const, label: t('vaultSourceOther'), icon: 'cash' as const },
            ]}
            value={source}
            onChange={setSource}
          />
        </Field>
        <Field label={t('optionalNote')}>
          <TextField value={note} onChange={setNote} placeholder={t('vaultNotePlaceholder')} />
        </Field>
        <PrimaryButton label={direction === 'DEPOSIT' ? t('vaultDeposit') : t('vaultWithdraw')} icon={direction === 'DEPOSIT' ? 'arrow-down' : 'arrow-up'} busy={busy} disabled={!valid} onPress={() => void save()} />
        <Text style={[s.note, { fontSize: 12 }]}>{source === 'SALARY' ? t('vaultNotSpendable') : source === 'PRIVATE' ? t('vaultPrivateHint') : t('vaultOtherHint')}</Text>
      </Card>

      <View style={{ gap: 10 }}>
        <SectionTitle title={t('vaultHistory')} count={vault.entries.length} />
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          {vault.entries.length ? vault.entries.map((entry, index) => {
            const incoming = entry.direction === 'DEPOSIT';
            return (
              <View key={entry.id} style={[s.row, index > 0 && s.divider]}>
                <IconBubble name={incoming ? 'arrow-down' : 'arrow-up'} color={incoming ? colors.success : colors.danger} background={incoming ? colors.successSoft : colors.dangerSoft} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={s.rowLabel}>{entry.note || (incoming ? t('vaultDeposit') : t('vaultWithdraw'))}</Text>
                  <Text style={s.rowSub}>{[format.date(entry.date), entry.source ? t(entry.source === 'SALARY' ? 'vaultSourceSalary' : entry.source === 'PRIVATE' ? 'vaultSourcePrivate' : 'vaultSourceOther') : null].filter(Boolean).join(' · ')}</Text>
                </View>
                <Text style={[s.rowValue, { color: incoming ? colors.success : colors.danger }]}>{visible ? `${incoming ? '+' : '−'}${format.money(entry.amount, entry.currency)}` : MASK}</Text>
                <InlineDelete label={entry.note ?? ''} onConfirm={() => withToken(async (tok) => setVault(await call((sess, r) => deleteVaultEntry(sess, tok, entry.id, r))))} />
              </View>
            );
          }) : <Text style={s.hint}>{t('vaultEmpty')}</Text>}
        </Card>
      </View>

      <Card style={{ gap: 6 }}>
        {bio ? (
          <ToggleRow label={bio === 'face' ? t('vaultUseFace') : t('vaultUseFingerprint')} value={Boolean(deviceId)} onChange={(on) => void setBiometric(on)} disabled={busy} />
        ) : (
          <Text style={s.note}>{Platform.OS === 'web' ? t('vaultWebPassword') : t('vaultBiometricNeedsUpdate')}</Text>
        )}
        {vault.devices.length ? (
          <>
            <Text style={[s.rowSub, { marginTop: 8 }]}>{t('vaultTrustedPhones')}</Text>
            {vault.devices.map((device, index) => (
              <View key={device.id} style={[s.row, index > 0 && s.divider]}>
                <Ionicons name="phone-portrait-outline" size={20} color={colors.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={s.rowLabel}>{device.label ?? t('vaultPhone')}{device.id === deviceId ? ` · ${t('vaultThisPhone')}` : ''}</Text>
                  <Text style={s.rowSub}>{format.date(device.createdAt.slice(0, 10))}</Text>
                </View>
                <InlineDelete
                  label={device.label ?? ''}
                  onConfirm={() =>
                    withToken(async (tok) => {
                      await call((sess, r) => forgetVaultDevice(sess, tok, device.id, r));
                      if (device.id === deviceId) {
                        await forgetDeviceKey(userId);
                        setDeviceId(null);
                      }
                      setVault(await call((sess, r) => getVault(sess, tok, r)));
                    })
                  }
                />
              </View>
            ))}
          </>
        ) : null}
      </Card>
    </ScrollView>
  );
}
