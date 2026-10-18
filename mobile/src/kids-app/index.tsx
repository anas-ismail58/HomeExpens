import { Redirect } from 'expo-router';

/** The app opens straight on the children's points. */
export default function Index() {
  return <Redirect href="/kids" />;
}
