import { useLocalSearchParams } from 'expo-router';
import { LoginScreen } from '../LoginScreen';
import { useSession } from '../SessionContext';

/** Invite link target: /join?code=ABCDE12345 opens the join form with the code checked. */
export default function Join() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { setSession } = useSession();
  return <LoginScreen key={code ?? ''} initialCode={code} onAuthenticated={setSession} />;
}
