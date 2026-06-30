const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    // Exclude the nodejs-mobile project directory — those are pre-bundled CJS
    // server files, not React Native source. Metro would hang trying to parse them.
    blockList: [
      new RegExp(path.join(__dirname, 'nodejs-assets', '.*').replace(/\\/g, '\\\\')),
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
