import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { DataStore } from './database/datastore.js';
import { hashToken } from './gateway/auth/access.js';

export function makeTmpDir(): string {
  const dir = join(tmpdir(), `pdh-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A fixed agent token for tests. Call addTestAgent(store) and send TEST_AGENT_AUTH. */
export const TEST_AGENT_TOKEN = 'pdh_test_token_for_unit_tests';
export const TEST_AGENT_AUTH = { Authorization: `Bearer ${TEST_AGENT_TOKEN}` };
export const ALL_PERMISSIONS = ['gmail', 'google_calendar', 'github', 'photo'].map((s) => `pull:${s}`);

/** Registers a test agent directly in the store. Returns its id. */
export async function addTestAgent(store: DataStore, name = 'test-agent', permissions: string[] = ALL_PERMISSIONS): Promise<string> {
  const id = `agent_${name}`;
  await store.insertAgent({ id, name, token_hash: hashToken(TEST_AGENT_TOKEN), permissions: JSON.stringify(permissions) });
  return id;
}
