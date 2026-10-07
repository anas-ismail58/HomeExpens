const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

/**
 * Apps built with the iOS 27 SDK must adopt the UIScene life cycle or UIKit aborts at launch
 * ("UIScene life cycle is required for apps built with this SDK"). The SDK 57 template still
 * creates the window in the app delegate, so this plugin:
 *  - registers Expo's ready-made scene delegate (EXExpoAppSceneDelegate) in Info.plist, and
 *  - makes AppDelegate an ExpoReactNativeFactoryProvider that only creates the React Native
 *    factory; the scene delegate creates the window and starts React Native into it.
 */
module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: 'EXExpoAppSceneDelegate',
          },
        ],
      },
    };
    return mod;
  });

  config = withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== 'swift') {
      throw new Error('withSceneLifecycle expects a Swift AppDelegate');
    }
    let contents = mod.modResults.contents;
    if (contents.includes('ExpoReactNativeFactoryProvider')) return mod;

    contents = contents.replace(
      'class AppDelegate: ExpoAppDelegate {',
      'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {',
    );

    const windowStartup = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;
    if (!windowStartup.test(contents)) {
      throw new Error('withSceneLifecycle: could not find the window start-up block in AppDelegate.swift');
    }
    contents = contents.replace(
      windowStartup,
      '\n    // The window is created by EXExpoAppSceneDelegate (UIScene life cycle), which starts React Native.\n',
    );

    mod.modResults.contents = contents;
    return mod;
  });

  return config;
};
