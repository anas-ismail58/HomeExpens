import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, requestPasswordReset } from './api';
import { PrimaryButton } from './components';
import { usePreferences, useStyles } from './preferences';
import { Text, TextInput } from './typography';

/**
 * "Forgot password?" from the login screen. No email is sent: a family member asks the father, who sets a
 * new password from the Family screen; the father's own account is reset by the app admin.
 */
export function ForgotPasswordSheet({ initialLogin, onClose }: { initialLogin: string; onClose: () => void }) {
  const { t, colors } = usePreferences();
  const insets = useSafeAreaInsets();
  const [login, setLogin] = useState(initialLogin.trim());
  const [step, setStep] = useState<'ask' | 'father' | 'admin'>('ask');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const id = login.trim().toLowerCase();

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
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      const { method } = await requestPasswordReset(id);
      setStep(method === 'admin' ? 'admin' : 'father');
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'NO_ACCOUNT' ? t('noAccountForLogin') : err instanceof ApiError && err.code === 'EMAIL_UNAVAILABLE' ? t('emailUnavailable') : err instanceof Error ? err.message : t('saveError'));
    } finally {
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
              ) : (
                <>
                  <View style={s.box}>
                    <Text style={s.boxText}>{step === 'admin' ? t('resetAskAppAdmin') : t('resetAskedFather')}</Text>
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
