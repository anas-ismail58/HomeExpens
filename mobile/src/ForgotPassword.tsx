import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { requestPasswordReset, resetPassword } from './api';
import { PrimaryButton } from './components';
import { normalizeDigits } from './formControls';
import { usePreferences, useStyles } from './preferences';
import { Text, TextInput } from './typography';

/**
 * "Forgot password?" from the login screen. An email account gets a 6-digit code by email and sets a
 * new password here; a username account (made by the father) asks the father, who resets it from the
 * Family screen.
 */
export function ForgotPasswordSheet({ initialLogin, onClose, onDone }: { initialLogin: string; onClose: () => void; onDone: (login: string) => void }) {
  const { t, colors } = usePreferences();
  const insets = useSafeAreaInsets();
  const [login, setLogin] = useState(initialLogin.trim());
  const [step, setStep] = useState<'ask' | 'sent'>('ask');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const id = login.trim().toLowerCase();
  const isEmail = id.includes('@');
  const cleanCode = normalizeDigits(code).replace(/\D/g, '');

  const s = useStyles((c, d) => ({
    backdrop: { flex: 1, justifyContent: 'flex-end' as const, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: { backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, gap: 14 },
    grab: { alignSelf: 'center' as const, width: 40, height: 5, borderRadius: 3, backgroundColor: c.border },
    head: { flexDirection: d.row, alignItems: 'center' as const, gap: 10 },
    title: { flex: 1, color: c.text, fontSize: 20, fontWeight: '800' as const, textAlign: d.start },
    body: { color: c.textSecondary, fontSize: 14, lineHeight: 21, textAlign: d.start },
    box: { gap: 6, padding: 14, borderRadius: 14, backgroundColor: c.primarySoft },
    boxText: { color: c.text, fontSize: 14, lineHeight: 21, textAlign: d.start },
    label: { color: c.textSecondary, fontSize: 13, fontWeight: '700' as const, textAlign: d.start },
    inputWrap: { flexDirection: d.row, alignItems: 'center' as const, gap: 10, minHeight: 52, borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingHorizontal: 14, backgroundColor: c.background },
    input: { flex: 1, minHeight: 50, color: c.text, fontSize: 15, textAlign: d.start },
    codeInput: { flex: 1, minHeight: 50, color: c.text, fontSize: 24, fontWeight: '800' as const, letterSpacing: 8, textAlign: 'center' as const },
    link: { minHeight: 40, alignItems: 'center' as const, justifyContent: 'center' as const },
    linkText: { color: c.primary, fontSize: 14, fontWeight: '700' as const },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
    notice: { color: c.success, fontSize: 13, textAlign: d.start },
  }));

  const send = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await requestPasswordReset(id);
      if (step === 'sent') setNotice(t('resetCodeResent'));
      setStep('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError('');
    try {
      await resetPassword(id, cleanCode, password);
      onDone(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel={t('close')}>
          <Pressable style={[s.sheet, { paddingBottom: insets.bottom + 20 }]} onPress={() => undefined}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14 }} showsVerticalScrollIndicator={false}>
              <View style={s.grab} />
              <View style={s.head}>
                <Ionicons name="key-outline" size={22} color={colors.primary} />
                <Text style={s.title}>{t('forgotPasswordTitle')}</Text>
                <Pressable onPress={onClose} accessibilityLabel={t('close')} hitSlop={10}>
                  <Ionicons name="close" size={22} color={colors.muted} />
                </Pressable>
              </View>

              {step === 'ask' ? (
                <>
                  <Text style={s.body}>{t('forgotPasswordBody')}</Text>
                  <Text style={s.label}>{t('emailOrUsername')}</Text>
                  <View style={s.inputWrap}>
                    <Ionicons name="mail" size={18} color={colors.muted} />
                    <TextInput value={login} onChangeText={setLogin} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={s.input} accessibilityLabel={t('emailOrUsername')} />
                  </View>
                  {error ? <Text style={s.error}>{error}</Text> : null}
                  <PrimaryButton label={t('sendResetRequest')} icon="paper-plane" onPress={() => void send()} busy={busy} disabled={id.length < 3} />
                </>
              ) : isEmail ? (
                <>
                  <View style={s.box}>
                    <Text style={s.boxText}>{t('resetCodeSent', { email: id })}</Text>
                  </View>
                  <Text style={s.label}>{t('resetCode')}</Text>
                  <View style={s.inputWrap}>
                    <TextInput
                      value={code}
                      onChangeText={setCode}
                      keyboardType="number-pad"
                      textContentType="oneTimeCode"
                      autoComplete="one-time-code"
                      maxLength={6}
                      style={s.codeInput}
                      accessibilityLabel={t('resetCode')}
                    />
                  </View>
                  <Text style={s.label}>{t('newPassword')}</Text>
                  <View style={s.inputWrap}>
                    <Ionicons name="lock-closed" size={18} color={colors.muted} />
                    <TextInput value={password} onChangeText={setPassword} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} style={s.input} accessibilityLabel={t('newPassword')} />
                    <Pressable onPress={() => setShow((v) => !v)} hitSlop={10} accessibilityLabel={t('showPassword')}>
                      <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.muted} />
                    </Pressable>
                  </View>
                  {error ? <Text style={s.error}>{error}</Text> : null}
                  {notice ? <Text style={s.notice}>{notice}</Text> : null}
                  <PrimaryButton label={t('setNewPassword')} icon="checkmark-circle" onPress={() => void reset()} busy={busy} disabled={cleanCode.length !== 6 || password.length < 4} />
                  <Pressable onPress={() => void send()} style={s.link} disabled={busy}>
                    <Text style={s.linkText}>{t('resendCode')}</Text>
                  </Pressable>
                  <Text style={[s.body, { fontSize: 12 }]}>{t('resetNoEmailHint')}</Text>
                </>
              ) : (
                <>
                  <View style={s.box}>
                    <Text style={s.boxText}>{t('resetAskedFather')}</Text>
                  </View>
                  <PrimaryButton label={t('done')} icon="checkmark" onPress={onClose} />
                </>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
