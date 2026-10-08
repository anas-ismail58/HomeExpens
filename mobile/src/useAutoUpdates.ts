import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { AppState } from 'react-native';

/**
 * Keeps an installed app on the latest published version (EAS Update, channel "production").
 * On launch expo-updates already downloads in the background; here we also check whenever the app
 * comes back to the foreground and restart into the new version straight away, so a change shows up
 * without reinstalling. Native changes (new native modules) still need a new build.
 */
export function useAutoUpdates() {
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const result = await Updates.checkForUpdateAsync();
        if (result.isAvailable) {
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
        }
      } catch {
        // Offline or the update server is unreachable: keep running the current version.
      } finally {
        busy = false;
      }
    };
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => subscription.remove();
  }, []);
}
