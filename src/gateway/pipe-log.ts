/**
 * The per-pipe log the owner reads in the Pipes panel: one entry per agent call (and per
 * owner call through the agent routes). Previews and test runs from the Pipes page are not
 * logged. Incoming entries keep counts and the released items' ids and titles, not their
 * bodies: the source still has those. Outgoing entries keep the whole action, since what
 * was sent is the point of the log.
 */
import type { DataStore, PipeRow } from '../database/datastore.js';
import type { PipeRun } from './pipes.js';
import type { OutgoingAction } from './pipes-outgoing.js';

function titleOf(row: unknown): string {
  const data = row && typeof row === 'object' ? (row as { data?: Record<string, unknown> }).data ?? (row as Record<string, unknown>) : {};
  const t = data.title ?? data.subject ?? data.summary ?? '';
  return String(t).slice(0, 200);
}

export async function logIncomingRun(store: DataStore, pipe: PipeRow, caller: string, purpose: string, run: PipeRun): Promise<void> {
  const summary = run.ok
    ? {
        itemsFetched: run.itemsFetched,
        itemsReturned: run.rows.length,
        released: run.rows.map((row) => ({
          source_item_id: row && typeof row === 'object' ? (row as { source_item_id?: unknown }).source_item_id ?? null : null,
          title: titleOf(row),
        })),
      }
    : { error: run.message };
  await store.insertPipeLog({
    pipe_id: pipe.id,
    caller,
    purpose,
    outcome: run.ok ? 'ok' : 'error',
    summary: JSON.stringify(summary),
    duration_ms: run.duration_ms,
  });
}

export async function logOutgoingCall(
  store: DataStore,
  pipe: PipeRow,
  caller: string,
  purpose: string,
  entry: { outcome: 'sent' | 'blocked' | 'failed' | 'error'; action: OutgoingAction | null; reason?: string; result?: unknown; duration_ms: number },
): Promise<void> {
  await store.insertPipeLog({
    pipe_id: pipe.id,
    caller,
    purpose,
    outcome: entry.outcome,
    summary: JSON.stringify({ action: entry.action, ...(entry.reason !== undefined ? { reason: entry.reason } : {}), ...(entry.result !== undefined ? { result: entry.result } : {}) }),
    duration_ms: entry.duration_ms,
  });
}
