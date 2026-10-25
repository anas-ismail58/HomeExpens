// Two apps from one project: "home expenses" (default) and "kids' points" (APP_VARIANT=kids).
// Both use the same accounts and server; the kids app only has the points pages (src/kids-app).
module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== 'kids') return { ...config, extra: { ...config.extra, appVariant: 'expenses' } };
  const { updates: _updates, runtimeVersion: _runtime, ...base } = config;
  return {
    ...base,
    name: 'نقاط الأطفال',
    slug: 'family-kids-points',
    scheme: 'familykids',
    // On the web the kids app is served from the same site, under /kids-app (see vercel.json).
    experiments: { ...config.experiments, baseUrl: process.env.KIDS_BASE_URL ?? '' },
    ios: { ...config.ios, bundleIdentifier: 'com.familyexpenses.kids' },
    // google-services.json is for com.familyexpenses.mobile; the kids app needs its own Firebase app first.
    android: { ...config.android, googleServicesFile: undefined, package: 'com.familyexpenses.kids', adaptiveIcon: { ...config.android.adaptiveIcon, backgroundColor: '#E0F2FE' } },
    plugins: config.plugins
      .filter((plugin) => plugin !== './plugins/withSiriAppIntent')
      .map((plugin) => (plugin === 'expo-router' ? ['expo-router', { root: './src/kids-app' }] : plugin)),
    // Over-the-air updates need its own EAS project; until then the kids app updates by reinstalling.
    extra: { router: {}, appVariant: 'kids' },
  };
};
