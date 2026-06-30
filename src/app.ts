/**
 * Shared app factory — reads config, creates the right DataStore,
 * and builds the gateway. Used by both src/index.ts and src/lambda.ts.
 */

import { resolve } from 'node:path';
import type { Hono } from 'hono';
import type { DataStore } from './database/datastore.js';
import type { ConnectorRegistry } from './gateway/connectors/types.js';
import type { HubConfigParsed } from './config/schema.js';
import type { TokenManager } from './gateway/auth/token-manager.js';
import { createGateway } from './gateway/gateway.js';
import { randomUUID } from 'node:crypto';

export interface AppResult {
  app: Hono;
  store: DataStore;
  config: HubConfigParsed;
  tokenManager: TokenManager;
  connectorRegistry: ConnectorRegistry;
}

export async function createApp(config: HubConfigParsed): Promise<AppResult> {
  // Create DataStore based on deployment.database (or PDH_MOBILE env var)
  let store: DataStore;
  const dbType = config.deployment.database ?? (process.env.PDH_MOBILE === 'true' ? 'sqljs' : 'sqlite');

  if (dbType === 'dynamodb') {
    const tableName = config.deployment.dynamodb_table ?? process.env.DYNAMODB_TABLE;
    if (!tableName) {
      throw new Error('deployment.dynamodb_table (or DYNAMODB_TABLE env var) is required when database is "dynamodb"');
    }
    const { DynamoDataStore } = await import('./database/dynamo-store.js');
    store = new DynamoDataStore(tableName);
  } else if (dbType === 'sqljs') {
    const dbPath = process.env.PDH_DB_PATH ?? resolve('pdh.db');
    const { SqlJsDataStore } = await import('./database/sqljs-store.js');
    store = await SqlJsDataStore.create(dbPath);
  } else {
    const { getDb } = await import('./database/db.js');
    const { SqliteDataStore } = await import('./database/sqlite-store.js');
    store = new SqliteDataStore(getDb(resolve('pdh.db')));
  }

  // Seed default skills on first run
  await seedDefaultSkills(store);

  const encryptionKey = config.encryption_key ?? process.env.PDH_ENCRYPTION_KEY ?? 'pdh-default-key';

  // Expose AI provider config as env vars
  if (config.ai?.api_key) {
    const envVarMap: Record<string, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      openai: 'OPENAI_API_KEY',
      google: 'GOOGLE_AI_API_KEY',
    };
    const envVar = envVarMap[config.ai.provider];
    if (envVar && !process.env[envVar]) {
      process.env[envVar] = config.ai.api_key;
    }
    if (config.ai.model && !process.env.AI_MODEL) {
      process.env.AI_MODEL = config.ai.model;
    }
  }

  const { app, tokenManager, connectorRegistry } = await createGateway({ store, config, encryptionKey });

  return { app, store, config, tokenManager, connectorRegistry };
}

async function seedDefaultSkills(store: DataStore): Promise<void> {
  const existing = await store.listSkills();

  // If skills exist with trigger_event already set, leave them alone
  if (existing.some(s => s.trigger_event && s.trigger_event !== 'sms_received')) return;
  if (existing.some(s => s.trigger_event === 'sms_received' && s.instructions?.trim())) return;

  // Delete any stale seeds from previous schema iterations
  for (const s of existing) await store.deleteSkill(s.id);

  const id = `skill_${randomUUID().slice(0, 12)}`;
  await store.insertSkill({
    id,
    name: 'SMS Auto Reply',
    trigger_event: 'sms_received',
    instructions: [
      'Context: Check the SMS thread history with this contact for prior scheduling or commitments.',
      'Context: Check the calendar for conflicts before replying to anything time-sensitive.',
      'Context: If the sender references a meeting or event by name, check email for related threads.',
      '',
      'Style: Reply in 1-3 sentences. Use the sender\'s first name if known. Write naturally as the phone owner. Do not identify yourself as AI unless directly asked.',
      '',
      'Rules: Do not reply to automated short codes or delivery notifications.',
      'Rules: Do not commit to a specific time or meeting unless the calendar confirms availability.',
      'Rules: Save new facts about this contact to memory when they share something relevant.',
    ].join('\n'),
    enabled: 1,
  });
}
