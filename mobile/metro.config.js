const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const workspaceRoot = path.resolve(__dirname, '..');

const config = {
  resolver: {
    // Exclude the nodejs-mobile project directory — those are pre-bundled CJS
    // server files, not React Native source. Metro would hang trying to parse them.
    blockList: [
      new RegExp(path.join(__dirname, 'nodejs-assets', '.*').replace(/\\/g, '\\\\')),
    ],
    // npm workspaces hoist react-native/@react-native/etc. to the repo root's
    // node_modules instead of mobile/node_modules — Metro only resolves
    // modules inside watchFolders, so without this it 500s on any hoisted dep.
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
  },
  // Let Metro see the workspace-linked @pdh/ui package and the hoisted root
  // node_modules, which live outside mobile/'s own directory tree.
  watchFolders: [path.resolve(workspaceRoot, 'packages', 'ui'), path.resolve(workspaceRoot, 'node_modules')],
};

module.exports = withNativeWind(mergeConfig(getDefaultConfig(__dirname), config), {
  input: './global.css',
});
