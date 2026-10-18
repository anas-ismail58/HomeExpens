import Constants from 'expo-constants';

// Which app this build is: the kids' points app is bundled from src/kids-app (see app.config.js).
// The router root is baked into every build (and its cache key), so it is the most reliable signal.
const routerRoot = process.env.EXPO_ROUTER_ABS_APP_ROOT ?? '';

export const APP_VARIANT: 'expenses' | 'kids' =
  /kids-app\/?$/.test(routerRoot) || Constants.expoConfig?.extra?.appVariant === 'kids' ? 'kids' : 'expenses';
