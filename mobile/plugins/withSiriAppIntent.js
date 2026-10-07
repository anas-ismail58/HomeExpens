const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod, withInfoPlist, withXcodeProject } = require('expo/config-plugins');

const sourceName = 'SiriAddHomeLessonIntent.swift';

module.exports = function withSiriAppIntent(config) {
  config = withInfoPlist(config, (mod) => {
    const apiUrl = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5001/api').trim().replace(/\/+$/, '');
    // Same rule as the app: a bare host gets the /api suffix.
    mod.modResults.FAMILY_EXPENSES_API_URL = /^https?:\/\/[^/]+$/i.test(apiUrl) ? `${apiUrl}/api` : apiUrl;
    mod.modResults.NSLocalNetworkUsageDescription = 'Connect to your family expense server on your local network.';
    const transport = mod.modResults.NSAppTransportSecurity || {};
    mod.modResults.NSAppTransportSecurity = {
      ...transport,
      NSAllowsArbitraryLoadsLocalNetworking: true,
    };
    return mod;
  });

  config = withDangerousMod(config, ['ios', async (mod) => {
    const source = path.join(mod.modRequest.projectRoot, 'plugins', sourceName);
    const destination = path.join(mod.modRequest.platformProjectRoot, sourceName);
    fs.copyFileSync(source, destination);
    return mod;
  }]);

  config = withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const target = project.getFirstTarget();
    const projectInfo = project.getFirstProject().firstProject;
    const group = project.findPBXGroupKey({ name: projectInfo.name }) || projectInfo.mainGroup;
    if (!project.hasFile(sourceName)) {
      project.addSourceFile(sourceName, { target: target.uuid }, group);
    }
    return mod;
  });

  return config;
};