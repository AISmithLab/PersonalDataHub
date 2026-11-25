import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { DataStore } from './database/datastore.js';
import { hashAgentKey } from './gateway/auth/access.js';

export function makeTmpDir(): string {
  const dir = join(tmpdir(), `pdh-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A fixed agent key for tests. Call addTestAgentKey(store) and send TEST_AGENT_AUTH. */
export const TEST_AGENT_KEY = 'pk_test_key_for_unit_tests';
export const TEST_AGENT_AUTH = { Authorization: `Bearer ${TEST_AGENT_KEY}` };

export async function addTestAgentKey(store: DataStore, name = 'test-agent'): Promise<string> {
  const id = `key_${name}`;
  await store.insertAgentKey({ id, name, key_hash: hashAgentKey(TEST_AGENT_KEY) });
  return id;
}
