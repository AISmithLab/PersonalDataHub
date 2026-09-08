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
// Explicitly from node:crypto — Node 18 has no global `crypto`, and this file runs before
// @hono/node-server (which incidentally defines one) is imported.
import { randomUUID } from 'node:crypto';
import { installJitlessFetch } from './mobile/jitless-fetch.js';

// Injected at compile time by scripts/bundle-mobile.cjs via esbuild --define
declare const __GMAIL_CLIENT_ID__: string;
declare const __GMAIL_CLIENT_SECRET__: string;
declare const __CAL_CLIENT_ID__: string;
declare const __CAL_CLIENT_SECRET__: string;

process.env.PDH_MOBILE = 'true';

const _dir: string = (typeof __dirname !== 'undefined')
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));

// nodejs-mobile runs jitless on iOS (Apple forbids JIT in third-party apps), so the engine
// exposes no WebAssembly and sql.js's .wasm build aborts on load. Point the store at the
// asm.js build instead — pure JS, no .wasm sidecar. Slower than WASM, but it works.
if (!process.env.SQLJS_ASM_PATH) {
  process.env.SQLJS_ASM_PATH = join(_dir, 'node_modules', 'sql.js', 'dist', 'sql-asm-memory-growth.js');
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
  const encKey = process.env.PDH_ENCRYPTION_KEY ?? randomUUID();
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
  // Before any gateway code is loaded: iOS has no WebAssembly, so Node's undici-backed
  // fetch globals have to be replaced first (see ./mobile/jitless-fetch.ts).
  await installJitlessFetch();

  // @hono/node-server captures `global.Request`/`global.Response` in its module body, so
  // it must be imported after the swap too — a static import here would run during this
  // module's own top-level evaluation and trip the undici getter before main() is entered.
  const { serve } = await import('@hono/node-server');
  const { createApp } = await import('./app.js');
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
