import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { onDataChanged } from './api';

const EVERY_MS = 60_000;

/**
 * Keeps a screen's data current without pulling to refresh: reloads when the screen is shown, right after
 * any change saved anywhere in the app, when the app comes back to the foreground, and every minute while
 * the screen is showing (changes made by other family members).
 */
export function useAutoRefresh(reload: () => unknown) {
  const latest = useRef(reload);
  useEffect(() => {
    latest.current = reload;
  }, [reload]);
  const focused = useRef(false);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void latest.current();
      const timer = setInterval(() => void latest.current(), EVERY_MS);
      return () => {
        focused.current = false;
        clearInterval(timer);
      };
    }, []),
  );

  useEffect(() => {
    // A change saved on another screen or in a sheet: refresh now (also in the background, so the
    // screen is already right when you come back to it).
    const stop = onDataChanged(() => void latest.current());
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && focused.current) void latest.current();
    });
    return () => {
      stop();
      subscription.remove();
    };
  }, []);
}
