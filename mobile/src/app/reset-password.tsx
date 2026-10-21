import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, resetPasswordWithLink } from '../api';
import { Card, GradientHero, PrimaryButton } from '../components';
import { usePreferences, useStyles } from '../preferences';
import { useSession } from '../SessionContext';
import { Text, TextInput } from '../typography';

/**
 * Opened from the password reset email Firebase sends (its action URL points here with `oobCode`).
 * Sets the new password in our database; open whether or not someone is signed in on this device.
 */
export default function ResetPasswordPage() {
  const { t, colors } = usePreferences();
  const { session } = useSession();
  const params = useLocalSearchParams<{ oobCode?: string; mode?: string }>();
  const oobCode = typeof params.oobCode === 'string' ? params.oobCode : '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [doneFor, setDoneFor] = useState('');

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { padding: 18, gap: 16, width: '100%' as const, maxWidth: 520, alignSelf: 'center' as const },
    heroTitle: { color: c.heroText, fontSize: 24, fontWeight: '800' as const, textAlign: d.start },
    heroSub: { color: c.heroMuted, fontSize: 14, textAlign: d.start, marginTop: 4 },
    label: { color: c.textSecondary, fontSize: 13, fontWeight: '700' as const, textAlign: d.start, marginBottom: 6 },
    inputWrap: { flexDirection: d.row, alignItems: 'center' as const, gap: 10, minHeight: 52, borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingHorizontal: 14, backgroundColor: c.background },
    input: { flex: 1, minHeight: 50, color: c.text, fontSize: 15, textAlign: d.start },
    body: { color: c.text, fontSize: 15, lineHeight: 22, textAlign: d.start },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  const mismatch = confirm.length > 0 && confirm !== password;
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const { email } = await resetPasswordWithLink(oobCode, password);
      setDoneFor(email);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'INVALID_RESET_LINK' ? t('resetLinkInvalid') : err instanceof Error ? err.message : t('saveError'));
    } finally {
      setBusy(false);
    }
  };
  const leave = () => router.replace(session ? '/' : '/login');

  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
          <GradientHero>
            <Text style={s.heroTitle}>{t('resetPageTitle')}</Text>
            <Text style={s.heroSub}>{t('appName')}</Text>
          </GradientHero>
          <Card style={{ gap: 14 }}>
            {doneFor ? (
              <>
                <Text style={s.body}>{t('passwordChangedSignIn')}</Text>
                <PrimaryButton label={t('signIn')} icon="log-in" onPress={leave} />
              </>
            ) : !oobCode ? (
              <>
                <Text style={s.body}>{t('resetLinkInvalid')}</Text>
                <PrimaryButton label={t('signIn')} icon="log-in" onPress={leave} />
              </>
            ) : (
              <>
                <View>
                  <Text style={s.label}>{t('newPassword')}</Text>
                  <View style={s.inputWrap}>
                    <Ionicons name="lock-closed" size={18} color={colors.muted} />
                    <TextInput value={password} onChangeText={setPassword} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" style={s.input} accessibilityLabel={t('newPassword')} />
                    <Pressable onPress={() => setShow((v) => !v)} hitSlop={10} accessibilityLabel={t('showPassword')}>
                      <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.muted} />
                    </Pressable>
                  </View>
                </View>
                <View>
                  <Text style={s.label}>{t('confirmPassword')}</Text>
                  <View style={s.inputWrap}>
                    <Ionicons name="lock-closed" size={18} color={colors.muted} />
                    <TextInput value={confirm} onChangeText={setConfirm} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" style={s.input} accessibilityLabel={t('confirmPassword')} />
                  </View>
                </View>
                {mismatch ? <Text style={s.error}>{t('passwordsDontMatch')}</Text> : null}
                {error ? <Text style={s.error}>{error}</Text> : null}
                <PrimaryButton label={t('setNewPassword')} icon="checkmark-circle" onPress={() => void save()} busy={busy} disabled={password.length < 4 || confirm !== password} />
              </>
            )}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
