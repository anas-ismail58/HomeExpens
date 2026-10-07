const { withEntitlementsPlist } = require('expo/config-plugins');

/**
 * Reminders are local (on-device) notifications, which need no Apple push entitlement.
 * expo-notifications adds `aps-environment`, which free (personal team) Apple IDs can't sign,
 * so drop it. Remove this plugin if remote push notifications are ever added.
 */
module.exports = function withLocalNotificationsOnly(config) {
  return withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['aps-environment'];
    return mod;
  });
};
