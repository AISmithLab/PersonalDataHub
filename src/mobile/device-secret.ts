/**
 * Device secret — how the phone app proves to its own bundled server that it is
 * the owner, without a sign-in screen.
 *
 * The server keeps a random secret in the app's private data directory. Other
 * apps on the phone cannot read that directory, so they cannot learn it. Two
 * callers need it:
 *   - the React Native shell, which asks for it over the nodejs-mobile bridge;
 *   - the Android SmsReceiver, which reads the file directly.
 * Both send it as X-PDH-Device-Secret (see gateway/auth/access.ts).
 *
 * Desktop and Lambda never call this, so PDH_DEVICE_SECRET stays unset there and
 * the header is ignored.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export const DEVICE_SECRET_FILE = 'device-secret';
const REQUEST = 'pdh:get-device-secret';
const REPLY = 'pdh:device-secret';

/** Loads the secret from dataDir (creating it on first start) and sets PDH_DEVICE_SECRET. */
export function initDeviceSecret(dataDir: string): string {
  const path = join(dataDir, DEVICE_SECRET_FILE);
  let secret = existsSync(path) ? readFileSync(path, 'utf8').trim() : '';
  if (secret.length < 32) {
    secret = randomBytes(32).toString('hex');
    writeFileSync(path, secret, { encoding: 'utf8', mode: 0o600 });
  }
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
  process.env.PDH_DEVICE_SECRET = secret;
  return secret;
}

/**
 * Answers the shell's request for the secret over the nodejs-mobile bridge.
 * The shell asks (rather than us pushing once) because it may attach its
 * listener after this process has started.
 */
export function serveDeviceSecretToShell(secret: string): void {
  try {
    // 'rn-bridge' exists only inside nodejs-mobile; it is not an npm dependency.
    const base = typeof __dirname !== 'undefined' ? __dirname + '/device-secret.js' : import.meta.url;
    const bridge = createRequire(base)('rn-bridge') as {
      channel: { on(event: 'message', cb: (msg: unknown) => void): void; send(msg: string): void };
    };
    bridge.channel.on('message', (msg) => {
      if (msg === REQUEST) bridge.channel.send(JSON.stringify({ type: REPLY, secret }));
    });
  } catch {
    console.warn('[PDH] rn-bridge not available; the app shell cannot fetch the device secret.');
  }
}
