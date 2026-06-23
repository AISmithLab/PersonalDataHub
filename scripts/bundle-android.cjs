#!/usr/bin/env node
// Reads hub-config.yaml and passes Google OAuth credentials as esbuild --define
// flags so android.ts can embed them in the default config at compile time.
const { execSync } = require('child_process');
const { parse } = require('yaml');
const { readFileSync } = require('fs');

let gmailClientId = '';
let gmailClientSecret = '';
let calClientId = '';
let calClientSecret = '';

try {
  const cfg = parse(readFileSync('hub-config.yaml', 'utf8'));
  gmailClientId     = cfg?.sources?.gmail?.owner_auth?.clientId     ?? '';
  gmailClientSecret = cfg?.sources?.gmail?.owner_auth?.clientSecret ?? '';
  calClientId       = cfg?.sources?.google_calendar?.owner_auth?.clientId     ?? '';
  calClientSecret   = cfg?.sources?.google_calendar?.owner_auth?.clientSecret ?? '';
} catch (e) {
  console.warn('[bundle-android] Could not read hub-config.yaml — credentials will be empty strings.');
}

const define = [
  `--define:__GMAIL_CLIENT_ID__='"${gmailClientId}"'`,
  `--define:__GMAIL_CLIENT_SECRET__='"${gmailClientSecret}"'`,
  `--define:__CAL_CLIENT_ID__='"${calClientId}"'`,
  `--define:__CAL_CLIENT_SECRET__='"${calClientSecret}"'`,
].join(' ');

const esbuild = require('path').join(__dirname, '..', 'node_modules', '.bin', 'esbuild');
execSync(
  `"${esbuild}" src/android.ts --bundle --platform=node --target=node18 --format=cjs --minify --outfile=www/nodejs/android.js --external:@aws-sdk/* --external:better-sqlite3 --external:sql.js ${define}`,
  { stdio: 'inherit' }
);
