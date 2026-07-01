#!/usr/bin/env node
// Bundle the Node.js backend for React Native (nodejs-mobile-react-native).
// Reads hub-config.yaml from the project root and embeds OAuth credentials at compile time.
// Outputs to mobile/nodejs-assets/nodejs-project/ which nodejs-mobile copies into the APK/IPA.

const { execSync } = require('child_process');
const { parse } = require('yaml');
const { readFileSync, mkdirSync, copyFileSync, writeFileSync } = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'mobile', 'nodejs-assets', 'nodejs-project');
const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild');

let gmailClientId = '', gmailClientSecret = '', calClientId = '', calClientSecret = '';
try {
  const cfg = parse(readFileSync(path.join(root, 'hub-config.yaml'), 'utf8'));
  gmailClientId     = cfg?.sources?.gmail?.owner_auth?.clientId     ?? '';
  gmailClientSecret = cfg?.sources?.gmail?.owner_auth?.clientSecret ?? '';
  calClientId       = cfg?.sources?.google_calendar?.owner_auth?.clientId     ?? '';
  calClientSecret   = cfg?.sources?.google_calendar?.owner_auth?.clientSecret ?? '';
} catch {
  console.warn('[bundle-mobile] Could not read hub-config.yaml — credentials will be empty strings.');
}

const define = [
  `--define:__GMAIL_CLIENT_ID__='"${gmailClientId}"'`,
  `--define:__GMAIL_CLIENT_SECRET__='"${gmailClientSecret}"'`,
  `--define:__CAL_CLIENT_ID__='"${calClientId}"'`,
  `--define:__CAL_CLIENT_SECRET__='"${calClientSecret}"'`,
].join(' ');

mkdirSync(outDir, { recursive: true });

const common = `--bundle --platform=node --target=node18 --format=cjs --minify --external:@aws-sdk/* --external:better-sqlite3 --external:sql.js ${define}`;

console.log('[bundle-mobile] Bundling android.ts…');
execSync(
  `"${esbuild}" src/android.ts ${common} --outfile="${path.join(outDir, 'android.js')}"`,
  { stdio: 'inherit', cwd: root }
);

console.log('[bundle-mobile] Bundling ios.ts…');
execSync(
  `"${esbuild}" src/ios.ts ${common} --outfile="${path.join(outDir, 'ios.js')}"`,
  { stdio: 'inherit', cwd: root }
);

// Copy sql.js WASM files — cannot be bundled, must be present at runtime
const sqlSrc = path.join(root, 'node_modules', 'sql.js', 'dist');
const sqlDst = path.join(outDir, 'node_modules', 'sql.js', 'dist');
mkdirSync(sqlDst, { recursive: true });
copyFileSync(path.join(sqlSrc, 'sql-wasm.js'),   path.join(sqlDst, 'sql-wasm.js'));
copyFileSync(path.join(sqlSrc, 'sql-wasm.wasm'), path.join(sqlDst, 'sql-wasm.wasm'));

const sqlPkg = JSON.parse(readFileSync(path.join(root, 'node_modules', 'sql.js', 'package.json'), 'utf8'));
writeFileSync(
  path.join(outDir, 'node_modules', 'sql.js', 'package.json'),
  JSON.stringify({ name: sqlPkg.name, version: sqlPkg.version, main: 'dist/sql-wasm.js' })
);

writeFileSync(
  path.join(outDir, 'package.json'),
  JSON.stringify({ name: 'pdh-mobile', version: '1.0.0', main: 'android.js' })
);

console.log('[bundle-mobile] Done →', outDir);
