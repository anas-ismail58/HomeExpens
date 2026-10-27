import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

/**
 * Face ID / fingerprint for the savings vault. The vault's device key lives in the phone's secure storage
 * behind biometrics (reading it shows the Face ID / fingerprint prompt). App builds made before biometrics
 * was added don't have the native module; they (and the web) use the password instead.
 */
type LocalAuth = typeof import('expo-local-authentication');

/** The biometrics module, or null on the web and in app builds made before it was added. */
export function localAuth(): LocalAuth | null {
  if (Platform.OS === 'web') return null;
  // Ask first whether this build has the native part: loading the package without it is a fatal error
  // (React Native reports module-load errors to its global handler, so a try/catch can't stop the crash).
  if (!requireOptionalNativeModule('ExpoLocalAuthentication')) return null;
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

// Kept in the keychain, never backed up or moved to another phone; the app asks for Face ID /
// fingerprint itself before every use.
const KEY_OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export async function saveDeviceKey(userId: string, deviceId: string, deviceKey: string) {
  await SecureStore.setItemAsync(keyName(userId), deviceKey, KEY_OPTIONS);
  await AsyncStorage.setItem(flagName(userId), deviceId);
}

/** Asks for Face ID / fingerprint, then returns the key; null when cancelled, failed or gone. */
export async function readDeviceKey(userId: string, prompt: string, cancelLabel: string) {
  if (!(await confirmWithBiometrics(prompt, cancelLabel))) return null;
  try {
    return await SecureStore.getItemAsync(keyName(userId), KEY_OPTIONS);
  } catch {
    return null;
  }
}

export async function forgetDeviceKey(userId: string) {
  await SecureStore.deleteItemAsync(keyName(userId)).catch(() => undefined);
  await AsyncStorage.removeItem(flagName(userId)).catch(() => undefined);
}

/** Shows the Face ID / fingerprint prompt (the phone passcode is the fallback). True when it succeeded. */
export async function confirmWithBiometrics(prompt: string, cancelLabel: string) {
  const auth = localAuth();
  if (!auth) return false;
  try {
    const result = await auth.authenticateAsync({ promptMessage: prompt, cancelLabel, disableDeviceFallback: false });
    return result.success;
  } catch {
    return false;
  }
}
