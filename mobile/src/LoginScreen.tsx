import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from './typography';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, completeTwoFactor, previewInvitation, register, rejectInvitation, signIn, type InvitationPreview, type Session } from './api';
import { Card, PrimaryButton, SegmentedControl, type IconName } from './components';
import { ForgotPasswordSheet } from './ForgotPassword';
import type { StringKey } from './i18n';
import { usePreferences, useStyles } from './preferences';
import { cardShadow } from './theme';

const FEATURES: { icon: IconName; label: StringKey }[] = [
  { icon: 'school', label: 'featureLessons' },
  { icon: 'home', label: 'featureHousehold' },
  { icon: 'pie-chart', label: 'featureInsights' },
];

type Mode = 'login' | 'register' | 'join';

/** Turns API errors into a clear message in the current language. */
function friendlyError(err: unknown, t: ReturnType<typeof usePreferences>['t'], invite: InvitationPreview | null, fallback: string) {
  const code = err instanceof ApiError ? err.code : undefined;
  switch (code) {
    case 'NOT_FATHER_ACCOUNT':
      return t('errNotFather');
    case 'FATHER_ACCOUNT':
      return t('errIsFather');
    case 'INVITE_NOT_FOUND':
      return t('errInviteNotFound');
    case 'INVITATION_EXPIRED':
      return t('errInviteExpired');
    case 'INVITE_WRONG_EMAIL':
      return t('errInviteWrongEmail', { email: invite?.emailHint ?? '' });
    case 'EMAIL_HAS_FAMILY':
      return t('errEmailHasFamily');
    case 'RATE_LIMITED':
      return t('errTooMany');
    case 'INVALID_OTP':
      return t('errBadOtp');
    case 'CHALLENGE_EXPIRED':
      return t('errOtpExpired');
    case 'TWO_FACTOR_SETUP_REQUIRED':
    case 'TWO_FACTOR_RESET_REQUIRED':
      return t('errOtpSetup');
    default:
      return err instanceof Error ? err.message : fallback;
  }
}

export function LoginScreen({ onAuthenticated, initialCode }: { onAuthenticated: (session: Session) => void; initialCode?: string }) {
  const { t, colors, language, setLanguage } = usePreferences();
  // An invite link (/join?code=…) opens straight on the join form with the code filled in.
  const [who, setWho] = useState<'FATHER' | 'MEMBER'>(initialCode ? 'MEMBER' : 'FATHER');
  const [mode, setMode] = useState<Mode>(initialCode ? 'join' : 'login');
  const isRegistering = mode !== 'login';
  const [inviteCode, setInviteCode] = useState((initialCode ?? '').toUpperCase());
  const [invite, setInvite] = useState<InvitationPreview | null>(null);
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** Set after a super admin's password is accepted: the app then asks for the authenticator code. */
  const [challenge, setChallenge] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [forgot, setForgot] = useState(false);

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    setNotice('');
    setInvite(null);
  };

  const checkCode = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setInvite(await previewInvitation(inviteCode));
    } catch (err) {
      setInvite(null);
      setError(friendlyError(err, t, null, t('loadError')));
    } finally {
      setBusy(false);
    }
  };

  // Check a code that arrived in the link right away.
  useEffect(() => {
    if (!initialCode) return;
    void Promise.resolve().then(checkCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  const decline = async () => {
    setBusy(true);
    try {
      await rejectInvitation(inviteCode);
      setInvite(null);
      setInviteCode('');
      setNotice(t('inviteDeclined'));
    } catch (err) {
      setError(friendlyError(err, t, invite, t('saveError')));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const session =
        mode === 'join'
          ? await register({ email, password, name, inviteCode, timezone })
          : mode === 'register'
            ? await register({ email, password, name, familyName, timezone })
            : await signIn(email, password, who);
      if ('twoFactorRequired' in session) {
        setChallenge(session.challenge);
        setOtp('');
        return;
      }
      onAuthenticated(session);
    } catch (err) {
      setError(friendlyError(err, t, invite, t('loginError')));
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    if (!challenge) return;
    setBusy(true);
    setError('');
    try {
      onAuthenticated(await completeTwoFactor(challenge, otp));
    } catch (err) {
      // An expired challenge means starting over from the password.
      if (err instanceof ApiError && err.code === 'CHALLENGE_EXPIRED') setChallenge(null);
      setOtp('');
      setError(friendlyError(err, t, invite, t('loginError')));
    } finally {
      setBusy(false);
    }
  };

  const s = useStyles((c, d) => ({
    safe: { flex: 1, backgroundColor: c.background },
    content: { flexGrow: 1, paddingBottom: 32 },
    header: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 70, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, overflow: 'hidden' as const },
    topRow: { flexDirection: d.row, justifyContent: 'space-between' as const, alignItems: 'center' as const },
    logo: { width: 56, height: 56, borderRadius: 18, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: 'rgba(255,255,255,0.2)' },
    logoText: { color: c.heroText, fontSize: 28, fontWeight: '800' as const },
    langButton: { flexDirection: d.row, alignItems: 'center' as const, gap: 6, paddingHorizontal: 12, minHeight: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.18)' },
    langText: { color: c.heroText, fontSize: 13, fontWeight: '700' as const },
    appName: { color: c.heroText, fontSize: 30, fontWeight: '800' as const, marginTop: 26, textAlign: d.start },
    tagline: { color: c.heroMuted, fontSize: 15, marginTop: 6, textAlign: d.start },
    features: { flexDirection: d.row, gap: 8, marginTop: 20, flexWrap: 'wrap' as const },
    feature: { flexDirection: d.row, alignItems: 'center' as const, gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.14)' },
    featureText: { color: c.heroText, fontSize: 12, fontWeight: '600' as const },
    card: { marginHorizontal: 18, marginTop: -44, padding: 20, gap: 16, ...cardShadow(c) },
    title: { color: c.text, fontSize: 22, fontWeight: '800' as const, textAlign: d.start },
    subtitle: { color: c.muted, fontSize: 14, lineHeight: 21, textAlign: d.start, marginTop: -8 },
    field: { gap: 7 },
    fieldLabel: { color: c.textSecondary, fontSize: 13, fontWeight: '700' as const, textAlign: d.start },
    inputWrap: { flexDirection: d.row, alignItems: 'center' as const, gap: 10, minHeight: 52, borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingHorizontal: 14, backgroundColor: c.background },
    input: { flex: 1, minHeight: 50, color: c.text, fontSize: 15, textAlign: d.start },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
    switch: { minHeight: 44, alignItems: 'center' as const, justifyContent: 'center' as const },
    switchText: { color: c.primary, fontSize: 14, fontWeight: '700' as const },
    invite: { gap: 6, padding: 14, borderRadius: 14, backgroundColor: c.primarySoft },
    inviteTitle: { color: c.text, fontSize: 14, fontWeight: '700' as const, lineHeight: 21, textAlign: d.start },
    inviteSub: { color: c.textSecondary, fontSize: 12, textAlign: d.start },
    notice: { color: c.success, fontSize: 13, textAlign: d.start },
    decline: { minHeight: 40, alignItems: 'center' as const, justifyContent: 'center' as const },
    declineText: { color: c.danger, fontSize: 13, fontWeight: '700' as const },
  }));

  const field = (label: string, icon: IconName, value: string, onChange: (v: string) => void, options: { secure?: boolean; email?: boolean; code?: boolean } = {}) => (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={s.inputWrap}>
        <Ionicons name={icon} size={18} color={colors.muted} />
        <TextInput
          accessibilityLabel={label}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={options.email ? 'email-address' : options.code ? 'number-pad' : 'default'}
          textContentType={options.code ? 'oneTimeCode' : undefined}
          autoComplete={options.code ? 'one-time-code' : undefined}
          maxLength={options.code ? 6 : undefined}
          onChangeText={onChange}
          secureTextEntry={options.secure && !showPassword}
          style={s.input}
          value={value}
        />
        {options.secure ? (
          <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8} accessibilityLabel={showPassword ? t('hidePassword') : t('showPassword')}>
            <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={19} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={s.safe} edges={['left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <LinearGradient colors={[colors.heroFrom, colors.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
            <SafeAreaView edges={['top']}>
              <View style={s.topRow}>
                <View style={s.logo}><Text style={s.logoText}>{language === 'ar' ? 'م' : 'F'}</Text></View>
                <Pressable onPress={() => setLanguage(language === 'ar' ? 'en' : 'ar')} style={s.langButton} accessibilityRole="button">
                  <Ionicons name="language" size={16} color={colors.heroText} />
                  <Text style={s.langText}>{language === 'ar' ? 'English' : 'العربية'}</Text>
                </Pressable>
              </View>
              <Text style={s.appName}>{t('appName')}</Text>
              <Text style={s.tagline}>{t('tagline')}</Text>
              <View style={s.features}>
                {FEATURES.map((feature) => (
                  <View key={feature.label} style={s.feature}>
                    <Ionicons name={feature.icon} size={14} color={colors.heroText} />
                    <Text style={s.featureText}>{t(feature.label)}</Text>
                  </View>
                ))}
              </View>
            </SafeAreaView>
          </LinearGradient>

          {challenge ? (
            <Card style={s.card}>
              <Text style={s.title}>{t('otpTitle')}</Text>
              <Text style={s.subtitle}>{t('otpSubtitle')}</Text>
              {field(t('otpCode'), 'shield-checkmark', otp, (value) => setOtp(value.replace(/\D/g, '').slice(0, 6)), { code: true })}
              {error ? <Text style={s.error}>{error}</Text> : null}
              <PrimaryButton label={t('otpVerify')} icon="shield-checkmark" onPress={() => void verifyOtp()} busy={busy} disabled={otp.length !== 6} />
              <Pressable onPress={() => { setChallenge(null); setOtp(''); setError(''); }} style={s.switch}>
                <Text style={s.switchText}>{t('otpBack')}</Text>
              </Pressable>
            </Card>
          ) : (
          <Card style={s.card}>
            {mode === 'login' ? (
              <View style={s.field}>
                <Text style={s.fieldLabel}>{t('whoSignsIn')}</Text>
                <SegmentedControl<'FATHER' | 'MEMBER'>
                  value={who}
                  onChange={(next) => { setWho(next); setError(''); }}
                  options={[{ value: 'FATHER', label: t('iAmFather') }, { value: 'MEMBER', label: t('iAmMember') }]}
                />
              </View>
            ) : null}
            <Text style={s.title}>{mode === 'join' ? t('joinFamily') : mode === 'register' ? t('createFamily') : t('welcomeBack')}</Text>
            <Text style={s.subtitle}>{mode === 'join' ? t('joinSubtitle') : mode === 'register' ? t('registerSubtitle') : t('loginSubtitle')}</Text>

            {mode === 'join' ? (
              <>
                {field(t('inviteCode'), 'ticket', inviteCode, (value) => { setInviteCode(value.toUpperCase()); setInvite(null); })}
                {!invite ? (
                  <PrimaryButton label={t('checkCode')} icon="search" onPress={() => void checkCode()} busy={busy} disabled={inviteCode.replace(/[^A-Za-z0-9]/g, '').length < 6} />
                ) : (
                  <View style={s.invite}>
                    <Text style={s.inviteTitle}>{t('invitePreview', { family: invite.familyName, inviter: invite.invitedBy, role: t(`role${invite.role}` as StringKey) })}</Text>
                    <Text style={s.inviteSub}>
                      {invite.status === 'PENDING' ? t('inviteSentTo', { email: invite.emailHint }) : t('inviteNotUsable', { status: t(`inviteStatus${invite.status}` as StringKey) })}
                    </Text>
                  </View>
                )}
              </>
            ) : null}

            {mode === 'register' ? (
              <>
                {/* Whoever creates the family is the father: parent and family admin. */}
                <View style={s.invite}>
                  <Text style={s.inviteTitle}>{t('youAreFather')}</Text>
                  <Text style={s.inviteSub}>{t('fatherCreatesAccounts')}</Text>
                </View>
                {field(t('fatherName'), 'person', name, setName)}
              </>
            ) : null}
            {mode === 'join' && invite?.status === 'PENDING' ? field(t('yourName'), 'person', name, setName) : null}
            {mode === 'register' ? field(t('familyName'), 'people', familyName, setFamilyName) : null}
            {mode !== 'join' || invite?.status === 'PENDING' ? (
              <>
                {field(isRegistering ? t('email') : t('emailOrUsername'), 'mail', email, setEmail, { email: isRegistering })}
                {field(t('password'), 'lock-closed', password, setPassword, { secure: true })}
                {mode === 'login' ? (
                  <Pressable onPress={() => setForgot(true)} style={[s.switch, { minHeight: 32, marginTop: -6, alignItems: 'flex-end' }]} accessibilityRole="button" accessibilityLabel={t('forgotPassword')}>
                    <Text style={[s.switchText, { fontSize: 13 }]}>{t('forgotPassword')}</Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}
            {forgot ? (
              <ForgotPasswordSheet
                initialLogin={email}
                onClose={() => setForgot(false)}
                onDone={(login) => {
                  setForgot(false);
                  setEmail(login);
                  setPassword('');
                  setError('');
                  setNotice(t('passwordChangedSignIn'));
                }}
              />
            ) : null}
            {error ? <Text style={s.error}>{error}</Text> : null}
            {notice ? <Text style={s.notice}>{notice}</Text> : null}
            {mode !== 'join' || invite?.status === 'PENDING' ? (
              <PrimaryButton
                label={mode === 'join' ? t('joinAndCreate') : mode === 'register' ? t('createAccount') : t('signIn')}
                icon={isRegistering ? 'person-add' : 'log-in'}
                onPress={() => void submit()}
                busy={busy}
                disabled={!email || !password || (isRegistering && !name) || (mode === 'register' && !familyName)}
              />
            ) : null}
            {mode === 'join' && invite?.status === 'PENDING' ? (
              <Pressable onPress={() => void decline()} style={s.decline} disabled={busy}>
                <Text style={s.declineText}>{t('declineInvite')}</Text>
              </Pressable>
            ) : null}

            {/* The father creates the family; members sign in with the account he made, or join with a code. */}
            {mode !== 'login' ? (
              <Pressable onPress={() => switchMode('login')} style={s.switch}>
                <Text style={s.switchText}>{t('haveAccount')}</Text>
              </Pressable>
            ) : who === 'FATHER' ? (
              <Pressable onPress={() => switchMode('register')} style={s.switch}>
                <Text style={s.switchText}>{t('newUser')}</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => switchMode('join')} style={s.switch}>
                <Text style={s.switchText}>{t('haveInvite')}</Text>
              </Pressable>
            )}
          </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
