import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const REFRESH_TOKEN_KEY = 'refreshToken';
export const SIRI_KEYCHAIN_SERVICE = 'familyexpenses.siri';

export async function readRefreshToken() {
  if (Platform.OS === 'web') return AsyncStorage.getItem(`family-expenses.${REFRESH_TOKEN_KEY}`);
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY, { keychainService: SIRI_KEYCHAIN_SERVICE });
}

export async function writeRefreshToken(token: string) {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(`family-expenses.${REFRESH_TOKEN_KEY}`, token);
    return;
  }
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, { keychainService: SIRI_KEYCHAIN_SERVICE });
}

export async function clearRefreshToken() {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(`family-expenses.${REFRESH_TOKEN_KEY}`);
    return;
  }
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY, { keychainService: SIRI_KEYCHAIN_SERVICE });
}