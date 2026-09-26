// Temporary Phase 1 smoke test for the GET /next strangler route.
// Not part of the permanent suite — delete once /next is exercised by real
// UI/e2e coverage (or once Phase 5 removes /next entirely).
import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { getDb } from '../../database/db.js';
import { SqliteDataStore } from '../../database/sqlite-store.js';
import { createServer } from '../server.js';
import { TokenManager } from '../auth/token-manager.js';
import type { ConnectorRegistry } from '../connectors/types.js';
import type { HubConfigParsed } from '../../config/schema.js';
import { makeTmpDir } from '../../test-utils.js';

function makeConfig(): HubConfigParsed {
  return {
    deployment: { gateway: 'local', database: 'sqlite' },
    sources: {},
    port: 3000,
    onboardingCompleted: true,
  };
}

describe('GET /next (Phase 1 strangler route)', () => {
  let tmpDir: string;

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('serves the React/NativeWind build without touching /', async () => {
    tmpDir = makeTmpDir();
    const db = getDb(join(tmpDir, 'test.db'));
    const store = new SqliteDataStore(db);
    const registry: ConnectorRegistry = new Map();
    const tokenManager = new TokenManager(store, 'test-secret');
    const app = createServer({ store, connectorRegistry: registry, config: makeConfig(), tokenManager });

    const oldRes = await app.request('/');
    const oldHtml = await oldRes.text();
    expect(oldRes.status).toBe(200);
    expect(oldHtml).toContain('PersonalDataHub');
    expect(oldHtml).not.toContain('__vite');

    const nextRes = await app.request('/next');
    const nextHtml = await nextRes.text();
    expect(nextRes.status).toBe(200);
    expect(nextHtml).toContain('<div id="root">');
    expect(nextHtml).toContain('<script type="module" crossorigin>');

    db.close();
  });
});
