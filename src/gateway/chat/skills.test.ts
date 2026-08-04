import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { getDb } from '../../database/db.js';
import { SqliteDataStore } from '../../database/sqlite-store.js';
import { filterToolsForSkillScopes, buildRunCodeBindings } from './routes.js';
import { PhotoConnector } from '../connectors/photo/connector.js';
import { TokenManager } from '../auth/token-manager.js';
import type { ConnectorRegistry } from '../connectors/types.js';
import type { HubConfigParsed } from '../../config/schema.js';
import type Database from 'better-sqlite3';
import { makeTmpDir } from '../../test-utils.js';

describe('Multi-Source Skills and Permission Scopes', () => {
  let tmpDir: string;
  let db: Database.Database;
  let store: SqliteDataStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    db = getDb(join(tmpDir, 'skills_test.db'));
    store = new SqliteDataStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('supports inserting and updating skills with multi-source trigger events and allowed_sources', async () => {
    store.insertSkill({
      id: 'skill_photo_test',
      name: 'Receipt & Expense Organizer',
      trigger_event: 'photo_added',
      instructions: 'Extract vendor and amount from receipt photo',
      summary: 'Receipt organizer',
      primitive_type: 'action',
      label_tag: null,
      allowed_sources: '["photo", "emails"]',
      enabled: 1,
    });

    const skills = await store.listSkills();
    const photoSkill = skills.find(s => s.id === 'skill_photo_test');
    expect(photoSkill).toBeDefined();
    expect(photoSkill?.trigger_event).toBe('photo_added');
    expect(photoSkill?.allowed_sources).toBe('["photo", "emails"]');

    store.updateSkill('skill_photo_test', {
      allowed_sources: '["photo"]',
      trigger_event: 'calendar_event_starting',
    });

    const updated = await store.listSkills();
    const updatedSkill = updated.find(s => s.id === 'skill_photo_test');
    expect(updatedSkill?.trigger_event).toBe('calendar_event_starting');
    expect(updatedSkill?.allowed_sources).toBe('["photo"]');
  });

  it('filterToolsForSkillScopes strips tools from unauthorized sources when allowed_sources is set', () => {
    const allTools = [
      { type: 'function', function: { name: 'read_calendar_events' } },
      { type: 'function', function: { name: 'create_calendar_event' } },
      { type: 'function', function: { name: 'read_emails' } },
      { type: 'function', function: { name: 'read_sms_thread' } },
      { type: 'function', function: { name: 'read_photos' } },
      { type: 'function', function: { name: 'save_memory' } },
      { type: 'function', function: { name: 'list_skills' } },
    ];

    // Case 1: No skills have allowed_sources restricted -> all tools returned
    const noScopeSkills = [
      { allowed_sources: null },
      { allowed_sources: '' },
    ];
    const unrestricted = filterToolsForSkillScopes(allTools, noScopeSkills);
    expect(unrestricted).toHaveLength(7);

    // Case 2: Skill allows only photo and emails
    const photoEmailSkill = [
      { allowed_sources: '["photo", "emails"]' },
    ];
    const scoped = filterToolsForSkillScopes(allTools, photoEmailSkill);
    const names = scoped.map(t => t.function.name);
    expect(names).toContain('read_photos');
    expect(names).toContain('read_emails');
    expect(names).toContain('save_memory');
    expect(names).toContain('list_skills');
    expect(names).not.toContain('read_calendar_events');
    expect(names).not.toContain('create_calendar_event');
    expect(names).not.toContain('read_sms_thread');
  });

  it('buildRunCodeBindings exposes __photos.list and __photos.stageDelete for agent-written code', async () => {
    const connector = new PhotoConnector();
    connector.setMemoryPhotos([
      {
        source: 'photo', source_item_id: 'img-a', type: 'image', timestamp: '2026-07-25T12:00:00Z',
        data: { title: 'Beach.jpg', album: 'Vacation', dataUrl: 'data:image/png;base64,AAA' },
      },
      {
        source: 'photo', source_item_id: 'img-b', type: 'image', timestamp: '2026-07-26T12:00:00Z',
        data: { title: 'Beach_copy.jpg', album: 'Vacation', dataUrl: 'data:image/png;base64,AAA' },
      },
    ]);

    const registry: ConnectorRegistry = new Map([['photo', connector]]);
    const config: HubConfigParsed = { deployment: { gateway: 'local', database: 'sqlite' }, sources: {}, port: 3000 };
    const deps = { store, connectorRegistry: registry, config, tokenManager: new TokenManager(store, 'test-secret') };

    const stagedActionIds: string[] = [];
    const bindings = buildRunCodeBindings(deps, stagedActionIds) as {
      __photos: { list: (params?: Record<string, unknown>) => Promise<any[]>; stageDelete: (id: string, reason?: string) => Promise<any> };
    };

    const photos = await bindings.__photos.list();
    expect(photos).toHaveLength(2);
    // Duplicate-detection logic like this is exactly what the agent is expected to write itself.
    const byHash = new Map<string, string[]>();
    for (const p of photos) {
      const list = byHash.get(p.dataUrl) ?? [];
      list.push(p.id);
      byHash.set(p.dataUrl, list);
    }
    const duplicateIds = [...byHash.values()].filter((ids) => ids.length > 1).flatMap((ids) => ids.slice(1));
    expect(duplicateIds).toEqual(['img-b']);

    const staged = await bindings.__photos.stageDelete('img-b', 'duplicate of img-a');
    expect(staged.ok).toBe(true);
    expect(stagedActionIds).toContain(staged.actionId);

    const action = await store.getStagingAction(staged.actionId);
    expect(action?.source).toBe('photo');
    expect(action?.action_type).toBe('delete_photo');
    expect(JSON.parse(action!.action_data)).toEqual({ photoId: 'img-b', reason: 'duplicate of img-a' });
  });

  it('buildRunCodeBindings omits __photos when the photo connector is not connected', () => {
    const registry: ConnectorRegistry = new Map();
    const config: HubConfigParsed = { deployment: { gateway: 'local', database: 'sqlite' }, sources: {}, port: 3000 };
    const deps = { store, connectorRegistry: registry, config, tokenManager: new TokenManager(store, 'test-secret') };

    const bindings = buildRunCodeBindings(deps, []);
    expect(bindings.__photos).toBeUndefined();
  });
});
