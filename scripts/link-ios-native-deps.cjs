#!/usr/bin/env node
// mobile/ios/Podfile and PersonalDataHub.xcodeproj's build phases shell out to
// `cd ../node_modules/<pkg>/...` relative to mobile/ios — i.e. they expect
// these packages physically inside mobile/node_modules. With npm workspaces,
// packages with no local version conflict get hoisted to the repo root's
// node_modules instead, so those `cd` calls fail at build time. Symlink the
// affected packages into mobile/node_modules so both layouts resolve.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mobileNodeModules = path.join(root, 'mobile', 'node_modules');

const packages = ['nodejs-mobile-react-native'];

fs.mkdirSync(mobileNodeModules, { recursive: true });

for (const pkg of packages) {
  const linkPath = path.join(mobileNodeModules, pkg);
  const hoistedPath = path.join(root, 'node_modules', pkg);

  if (fs.existsSync(linkPath)) continue;
  if (!fs.existsSync(hoistedPath)) {
    console.warn(`[link-ios-native-deps] WARNING: ${pkg} not found in root node_modules; skipping.`);
    continue;
  }

  fs.symlinkSync(path.join('..', '..', 'node_modules', pkg), linkPath, 'dir');
  console.log(`[link-ios-native-deps] Linked mobile/node_modules/${pkg} -> root node_modules/${pkg}`);
}
