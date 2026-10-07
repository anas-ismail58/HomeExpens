import { LoginScreen } from '../LoginScreen';
import { useSession } from '../SessionContext';

export default function Login() {
  const { setSession } = useSession();
  return <LoginScreen onAuthenticated={setSession} />;
}
