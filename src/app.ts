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

  // If the user has custom/non-default skills, don't overwrite
  const hasCustomSmsSkill = existing.some(s => 
    s.trigger_event === 'sms_received' && 
    s.instructions && 
    !s.instructions.startsWith('Context:') &&
    !s.instructions.startsWith('If the sender is')
  );
  const hasOtherTriggers = existing.some(s => s.trigger_event && s.trigger_event !== 'sms_received');
  if (hasCustomSmsSkill || hasOtherTriggers) return;

  // Delete any stale seeds from previous schema iterations
  for (const s of existing) await store.deleteSkill(s.id);

  const id = `skill_${randomUUID().slice(0, 12)}`;
  await store.insertSkill({
    id,
    name: 'SMS Auto Reply',
    trigger_event: 'sms_received',
    current_view: 'LOGICAL',
    logic_tree: JSON.stringify([
      {
        id: 'node_1',
        type: 'CONTEXT',
        condition: null,
        action: 'Check the SMS thread history with this contact for prior scheduling or commitments.'
      },
      {
        id: 'node_2',
        type: 'CONTEXT',
        condition: null,
        action: 'Check the calendar for conflicts before replying to anything time-sensitive.'
      },
      {
        id: 'node_3',
        type: 'CONTEXT',
        condition: null,
        action: 'If the sender references a meeting or event by name, check email for related threads.'
      },
      {
        id: 'node_4',
        type: 'IF',
        condition: 'the sender is an automated short code or a delivery notification',
        action: 'Do not reply to the message.'
      },
      {
        id: 'node_5',
        type: 'ELIF',
        condition: 'the calendar shows conflicts or a commitment cannot be confirmed',
        action: 'Do not commit to a specific time or meeting.'
      },
      {
        id: 'node_6',
        type: 'ELIF',
        condition: 'the sender shares a new fact about themselves or their preferences',
        action: 'Save the fact to memory.'
      },
      {
        id: 'node_7',
        type: 'ELSE',
        condition: null,
        action: 'Reply naturally in 1-3 sentences as the phone owner, using the sender\'s first name if known, and do not identify as AI unless directly asked.'
      }
    ]),
    instructions: [
      'Context: Check the SMS thread history with this contact for prior scheduling or commitments.',
      'Context: Check the calendar for conflicts before replying to anything time-sensitive.',
      'Context: If the sender references a meeting or event by name, check email for related threads.',
      'If the sender is an automated short code or a delivery notification, do not reply to the message.',
      'Alternatively, if the calendar shows conflicts or a commitment cannot be confirmed, do not commit to a specific time or meeting.',
      'Alternatively, if the sender shares a new fact about themselves or their preferences, save the fact to memory.',
      'Otherwise, reply naturally in 1-3 sentences as the phone owner, using the sender\'s first name if known, and do not identify as AI unless directly asked.'
    ].join('\n'),
    enabled: 1,
  });
}
