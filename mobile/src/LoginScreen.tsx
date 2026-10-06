import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { register, signIn, type Session } from './api';

export function LoginScreen({ onAuthenticated }: { onAuthenticated: (session: Session) => void }) {
  const [isRegistering, setIsRegistering] = useState(false);
  const [name, setName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const session = isRegistering
        ? await register({ email, password, name, familyName })
        : await signIn(email, password);
      onAuthenticated(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل الدخول. حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brandMark}><Text style={styles.brandMarkText}>م</Text></View>
          <Text style={styles.eyebrow}>إدارة مالية للأسرة</Text>
          <Text style={styles.title}>{isRegistering ? 'أنشئ حساب عائلتك' : 'مرحبًا بعودتك'}</Text>
          <Text style={styles.subtitle}>
            {isRegistering ? 'ابدأ بتنظيم مصاريف المنزل والدروس.' : 'سجّل الدخول لمتابعة مصاريف العائلة.'}
          </Text>

          <View style={styles.form}>
            {isRegistering ? (
              <>
                <Field label="اسمك" value={name} onChangeText={setName} autoCapitalize="words" />
                <Field label="اسم العائلة" value={familyName} onChangeText={setFamilyName} autoCapitalize="words" />
              </>
            ) : null}
            <Field label="البريد الإلكتروني" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
            <Field label="كلمة المرور" value={password} onChangeText={setPassword} secureTextEntry />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              accessibilityRole="button"
              disabled={busy || !email || !password || (isRegistering && (!name || !familyName))}
              onPress={() => void submit()}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, busy && styles.disabled]}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{isRegistering ? 'إنشاء الحساب' : 'تسجيل الدخول'}</Text>}
            </Pressable>
            <Pressable onPress={() => { setIsRegistering((value) => !value); setError(''); }} style={styles.switchButton}>
              <Text style={styles.switchText}>
                {isRegistering ? 'لديك حساب بالفعل؟ تسجيل الدخول' : 'مستخدم جديد؟ أنشئ حسابًا'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address';
  autoCapitalize?: 'none' | 'words';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        autoCapitalize={props.autoCapitalize ?? 'none'}
        autoCorrect={false}
        keyboardType={props.keyboardType ?? 'default'}
        onChangeText={props.onChangeText}
        secureTextEntry={props.secureTextEntry}
        style={styles.input}
        textAlign="right"
        value={props.value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#f1f5f3' },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 32 },
  brandMark: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#0c5949' },
  brandMarkText: { color: '#fff', fontSize: 28, fontWeight: '700' },
  eyebrow: { color: '#61736c', fontSize: 12, marginTop: 27, textAlign: 'right' },
  title: { color: '#172b27', fontSize: 27, fontWeight: '700', marginTop: 8, textAlign: 'right' },
  subtitle: { color: '#61736c', fontSize: 14, lineHeight: 22, marginTop: 7, textAlign: 'right' },
  form: { gap: 16, marginTop: 30 },
  field: { gap: 7 },
  fieldLabel: { color: '#465951', fontSize: 12, fontWeight: '600', textAlign: 'right' },
  input: { height: 48, borderWidth: 1, borderColor: '#d5e0da', borderRadius: 10, paddingHorizontal: 13, color: '#172b27', backgroundColor: '#fff', fontSize: 15 },
  error: { color: '#ad392d', fontSize: 13, textAlign: 'right' },
  primaryButton: { height: 49, alignItems: 'center', justifyContent: 'center', marginTop: 2, borderRadius: 10, backgroundColor: '#0c5949' },
  primaryText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  switchButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  switchText: { color: '#0c5949', fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.55 },
});