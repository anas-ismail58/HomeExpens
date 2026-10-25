import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Face ID / fingerprint for the savings vault. The vault's device key lives in the phone's secure storage
 * behind biometrics (reading it shows the Face ID / fingerprint prompt). App builds made before biometrics
 * was added don't have the native module; they (and the web) use the password instead.
 */
type LocalAuth = typeof import('expo-local-authentication');

function localAuth(): LocalAuth | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-local-authentication') as LocalAuth;
  } catch {
    return null;
  }
}

const keyName = (userId: string) => `vault_device_${userId.replace(/[^A-Za-z0-9]/g, '')}`;
const flagName = (userId: string) => `vault-device:${userId}`;

/** 'face' | 'fingerprint' when this phone can use biometrics for the vault, otherwise null. */
export async function biometricKind(): Promise<'face' | 'fingerprint' | null> {
  const auth = localAuth();
  if (!auth) return null;
  try {
    if (!(await auth.hasHardwareAsync()) || !(await auth.isEnrolledAsync())) return null;
    const types = await auth.supportedAuthenticationTypesAsync();
    return types.includes(auth.AuthenticationType.FACIAL_RECOGNITION) ? 'face' : 'fingerprint';
  } catch {
    return null;
  }
}

/** The server id of this phone's trusted-device entry, when it has one. */
export async function trustedDeviceId(userId: string) {
  return AsyncStorage.getItem(flagName(userId)).catch(() => null);
}

export async function saveDeviceKey(userId: string, deviceId: string, deviceKey: string, prompt: string) {
  await SecureStore.setItemAsync(keyName(userId), deviceKey, { requireAuthentication: true, authenticationPrompt: prompt });
  await AsyncStorage.setItem(flagName(userId), deviceId);
}

/** Shows the Face ID / fingerprint prompt and returns the key, or null when cancelled or gone. */
export async function readDeviceKey(userId: string, prompt: string) {
  try {
    return await SecureStore.getItemAsync(keyName(userId), { requireAuthentication: true, authenticationPrompt: prompt });
  } catch {
    return null;
  }
}

export async function forgetDeviceKey(userId: string) {
  await SecureStore.deleteItemAsync(keyName(userId)).catch(() => undefined);
  await AsyncStorage.removeItem(flagName(userId)).catch(() => undefined);
}
