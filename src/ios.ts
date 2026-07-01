/**
 * iOS entry point — runs inside nodejs-mobile-react-native's background thread.
 *
 * Starts the Hono server on port 3000. The React Native WebView then loads
 * http://127.0.0.1:3000 once the server is ready.
 *
 * Unlike android.ts, no DNS patches are needed — iOS resolver works correctly.
 */

import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { serve } from '@hono/node-server';

// Injected at compile time by scripts/bundle-mobile.cjs via esbuild --define
declare const __GMAIL_CLIENT_ID__: string;
declare const __GMAIL_CLIENT_SECRET__: string;
declare const __CAL_CLIENT_ID__: string;
declare const __CAL_CLIENT_SECRET__: string;

process.env.PDH_MOBILE = 'true';

const _dir: string = (typeof __dirname !== 'undefined')
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));

if (!process.env.SQLJS_WASM_PATH) {
  process.env.SQLJS_WASM_PATH = join(_dir, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
}

// nodejs-mobile on iOS copies the project into the app's Library directory.
// Data directory goes one level above _dir so it survives app updates.
const dataDir = process.env.PDH_DATA_DIR ?? join(_dir, '..', 'pdh-data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
process.env.PDH_DATA_DIR = dataDir;
process.env.PDH_DB_PATH = join(dataDir, 'pdh.db');

const configPath = process.env.PDH_CONFIG_PATH ?? join(dataDir, 'hub-config.yaml');
process.env.PDH_CONFIG_PATH = configPath;

if (!existsSync(configPath)) {
  const encKey = process.env.PDH_ENCRYPTION_KEY ?? crypto.randomUUID();
  const defaultConfig = `# PersonalDataHub — auto-generated mobile config
deployment:
  database: sqljs

encryption_key: "${encKey}"

sources:
  gmail:
    enabled: true
  google_calendar:
    enabled: true
  github:
    enabled: true

port: 3000
`;
  writeFileSync(configPath, defaultConfig, 'utf8');
  process.env.PDH_ENCRYPTION_KEY = encKey;
}

const port = Number(process.env.PORT ?? 3000);

async function main() {
  const { loadConfig } = await import('./config/loader.js');
  const config = await loadConfig(configPath);

  if (__GMAIL_CLIENT_ID__) {
    config.sources.gmail ??= { enabled: true, boundary: {} };
    (config.sources.gmail as Record<string, unknown>).owner_auth = {
      type: 'oauth2', clientId: __GMAIL_CLIENT_ID__, clientSecret: __GMAIL_CLIENT_SECRET__,
    };
  }
  if (__CAL_CLIENT_ID__) {
    config.sources.google_calendar ??= { enabled: true, boundary: {} };
    (config.sources.google_calendar as Record<string, unknown>).owner_auth = {
      type: 'oauth2', clientId: __CAL_CLIENT_ID__, clientSecret: __CAL_CLIENT_SECRET__,
    };
  }

  const { app } = await createApp(config);

  serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
    console.log(`[PDH iOS] Server running on http://127.0.0.1:${port}`);
  });
}

main().catch((err) => {
  console.error('[PDH iOS] Fatal startup error:', err);
  process.exit(1);
});
