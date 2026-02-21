import { randomUUID } from 'node:crypto';
import type { Operator, PipelineContext, OperatorResult } from './types.js';
import type { DataRow } from '../connectors/types.js';
import { encryptField } from '../db/encryption.js';

export const storeOperator: Operator = {
  type: 'store',

  async execute(
    input: DataRow[],
    context: PipelineContext,
    _props: Record<string, unknown>,
  ): Promise<OperatorResult> {
    const upsert = context.db.prepare(`
      INSERT INTO cached_data (id, source, source_item_id, type, timestamp, data, cached_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
      ON CONFLICT(source, source_item_id) DO UPDATE SET
        type = excluded.type,
        timestamp = excluded.timestamp,
        data = excluded.data,
        cached_at = excluded.cached_at,
        expires_at = excluded.expires_at
    `);

    const sourceConfig = context.config.sources[input[0]?.source];
    const ttl = sourceConfig?.cache?.ttl;
    const expiresAt = ttl ? computeExpiresAt(ttl) : null;

    const insertMany = context.db.transaction((rows: DataRow[]) => {
      for (const row of rows) {
        let dataStr = JSON.stringify(row.data);
        if (context.encryptionKey) {
          dataStr = encryptField(dataStr, context.encryptionKey);
        }

        upsert.run(
          randomUUID(),
          row.source,
          row.source_item_id,
          row.type,
          row.timestamp,
          dataStr,
          expiresAt,
        );
      }
    });

    insertMany(input);

    // Pass-through: return the same rows for the next operator
    return input;
  },
};

function computeExpiresAt(ttl: string): string {
  const now = Date.now();
  const match = ttl.match(/^(\d+)([dhm])$/);
  if (!match) return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(); // default 7d

  const amount = parseInt(match[1], 10);
  const unit = match[2];

  let ms: number;
  switch (unit) {
    case 'd':
      ms = amount * 24 * 60 * 60 * 1000;
      break;
    case 'h':
      ms = amount * 60 * 60 * 1000;
      break;
    case 'm':
      ms = amount * 60 * 1000;
      break;
    default:
      ms = 7 * 24 * 60 * 60 * 1000;
  }

  return new Date(now + ms).toISOString();
}
