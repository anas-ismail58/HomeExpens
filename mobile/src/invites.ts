import * as Clipboard from 'expo-clipboard';
import { Linking, Platform, Share } from 'react-native';
import { apiBaseUrl, type Invitation } from './api';

/** Web address of the app (the API lives under /api on the same domain). */
function appOrigin() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return apiBaseUrl().replace(/\/api\/?$/, '');
}

/** Opens the join screen with the code filled in. */
export function inviteLink(code: string) {
  return `${appOrigin()}/join?code=${encodeURIComponent(code)}`;
}

export function inviteMessage(invitation: Pick<Invitation, 'code' | 'email'>, familyName: string, template: (params: Record<string, string>) => string) {
  return template({ family: familyName, code: invitation.code, email: invitation.email, link: inviteLink(invitation.code) });
}

export async function copyText(text: string) {
  await Clipboard.setStringAsync(text);
}

/** WhatsApp works from phones and desktop browsers alike. */
export async function shareOnWhatsApp(message: string) {
  await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`);
}

/** System share sheet where it exists (phones, some browsers); falls back to copying. Returns 'copied' on fallback. */
export async function shareInvite(message: string): Promise<'shared' | 'copied'> {
  const canShareOnWeb = Platform.OS === 'web' && typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  if (Platform.OS !== 'web' || canShareOnWeb) {
    try {
      await Share.share({ message });
      return 'shared';
    } catch {
      // Fall through to copying.
    }
  }
  await copyText(message);
  return 'copied';
}
