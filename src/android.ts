/**
 * Android entry point — runs inside nodejs-mobile-capacitor's background thread.
 *
 * Node.js Mobile starts this file via the `nodejs-mobile-capacitor` plugin
 * on app launch. It starts the Hono server on port 3000, which the Capacitor
 * WebView then loads via capacitor.config.ts → server.url.
 *
 * Environment:
 *   PDH_MOBILE=true       → selects sql.js DataStore (no native SQLite bindings)
 *   PDH_DB_PATH           → path to the on-device .db file (set automatically)
 *   PDH_CONFIG_PATH       → path to hub-config.yaml on the device
 *   PDH_ENCRYPTION_KEY    → master encryption key (set during first-launch setup)
 */

import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import dns from 'node:dns';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { serve } from '@hono/node-server';

// nodejs-mobile on Android: the OS resolver (getaddrinfo) used by dns.lookup() doesn't
// inherit the system DNS config, so all outbound HTTPS calls fail with ENOTFOUND.
// dns.setServers() only affects dns.resolve*() — NOT dns.lookup() — so we also patch
// dns.lookup to route through dns.resolve4, which does respect setServers().
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

// Probe: confirm dns.resolve4 works from this thread context before patching dns.lookup.
dns.resolve4('oauth2.googleapis.com', (err, addrs) => {
  if (err) {
    console.error('[PDH dns probe] FAIL — c-ares cannot reach DNS servers:', err.code);
  } else {
    console.log('[PDH dns probe] OK — oauth2.googleapis.com =>', addrs[0]);
  }
});

const _lookup = dns.lookup.bind(dns);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(dns as any).lookup = (hostname: string, optionsOrCb: any, cb?: any) => {
  const callback = typeof optionsOrCb === 'function' ? optionsOrCb : cb;
  const options = typeof optionsOrCb === 'object' ? optionsOrCb : {};
  dns.resolve4(hostname, (err, addresses) => {
    if (!err && addresses.length > 0) {
      if (options.all) {
        callback(null, addresses.map((a: string) => ({ address: a, family: 4 })));
      } else {
        callback(null, addresses[0], 4);
      }
    } else {
      _lookup(hostname, optionsOrCb, cb);
    }
  });
};

// Injected at compile time by scripts/bundle-android.js via esbuild --define
declare const __GMAIL_CLIENT_ID__: string;
declare const __GMAIL_CLIENT_SECRET__: string;
declare const __CAL_CLIENT_ID__: string;
declare const __CAL_CLIENT_SECRET__: string;

// Signal to app.ts to use the sql.js DataStore
process.env.PDH_MOBILE = 'true';

// Resolve the directory containing this file so sql.js can find its WASM binary.
// When bundled by esbuild to CJS, __dirname is defined. In ESM we derive it.
const _dir: string = (typeof __dirname !== 'undefined')
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));

// sql-wasm.wasm lives inside the sql.js package that assets:android copies into
// www/nodejs/node_modules/sql.js/dist/ — which lands at _dir/node_modules/sql.js/dist/
if (!process.env.SQLJS_WASM_PATH) {
  process.env.SQLJS_WASM_PATH = join(_dir, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
}

// On Android the plugin copies the project to:
//   getFilesDir()/nodejs/public/   ← this is _dir
// App data should live in getFilesDir()/pdh-data/ (two levels up from _dir).
// Fall back to process.cwd()/pdh-data for desktop/CI runs.
const dataDir = process.env.PDH_DATA_DIR ?? join(_dir, '..', '..', 'pdh-data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
process.env.PDH_DATA_DIR = dataDir;

process.env.PDH_DB_PATH = join(dataDir, 'pdh.db');

const configPath = process.env.PDH_CONFIG_PATH ?? join(dataDir, 'hub-config.yaml');
process.env.PDH_CONFIG_PATH = configPath;

// Bootstrap a minimal config if none exists yet — credentials are never written to disk,
// they are injected into the in-memory config object below.
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

  // Inject OAuth credentials from compile-time constants — they never touch the on-device YAML.
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
    console.log(`[PDH Android] Server running on http://127.0.0.1:${port}`);
    // Drain any SMS queue files written by SmsReceiver while the server was down
    drainSmsQueue(dataDir, port);
  });
}

async function drainSmsQueue(dir: string, port: number) {
  const queueDir = join(dir, 'sms_queue');
  if (!existsSync(queueDir)) return;
  let files: string[];
  try { files = readdirSync(queueDir).filter(f => f.endsWith('.json')); } catch { return; }
  for (const file of files) {
    const filePath = join(queueDir, file);
    try {
      const body = readFileSync(filePath, 'utf-8');
      const res = await fetch(`http://127.0.0.1:${port}/sms/auto-reply?drain=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (res.ok) {
        unlinkSync(filePath);
        console.log(`[PDH Android] Drained queued SMS: ${file}`);
      }
    } catch (e) {
      console.warn(`[PDH Android] Failed to drain ${file}:`, e);
    }
  }
}

main().catch((err) => {
  console.error('[PDH Android] Fatal startup error:', err);
  process.exit(1);
});
