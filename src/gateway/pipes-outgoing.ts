/**
 * Outgoing pipes: an agent's action (send an email, create an event) goes out through
 * the owner's account only if the pipe's program passes it.
 *
 * The program is the body of an async function with `action` ({ type, data }) in scope
 * and returns pass() or block(reason). It runs in a vm context with nothing else: no
 * ask, network, files or timers. Anything other than pass() or block(), a throw, or a
 * timeout counts as an error, and an error never sends. In this first version the action
 * reaches the program, and then the connector, exactly as the agent sent it (see the
 * design's "Future work").
 */
import vm from 'node:vm';

export const OUTGOING_SOURCES = ['gmail', 'google_calendar'] as const;
export type OutgoingSource = (typeof OUTGOING_SOURCES)[number];

export const ACTION_TYPES: Record<OutgoingSource, readonly string[]> = {
  gmail: ['send_email', 'reply_email', 'draft_email'],
  google_calendar: ['create_event', 'update_event', 'delete_event'],
};

export type OutgoingAction = { type: string; data: Record<string, unknown> };

export type GateResult =
  | { outcome: 'pass' }
  | { outcome: 'block'; reason: string }
  | { outcome: 'error'; message: string };

const GATE_TIMEOUT_MS = 10_000;
const BAD_RETURN = 'The program must return pass() or block(reason).';

export function isOutgoingSource(source: string): source is OutgoingSource {
  return (OUTGOING_SOURCES as readonly string[]).includes(source);
}

export function checkAction(source: string, input: unknown): { ok: true; action: OutgoingAction } | { ok: false; message: string } {
  if (!isOutgoingSource(source)) return { ok: false, message: `${source} has no actions an outgoing pipe can carry.` };
  const types = ACTION_TYPES[source];
  const a = input as { type?: unknown; data?: unknown } | null;
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { ok: false, message: 'action must be an object: { type, data }.' };
  if (typeof a.type !== 'string' || !types.includes(a.type)) return { ok: false, message: `action.type must be one of: ${types.join(', ')}.` };
  if (!a.data || typeof a.data !== 'object' || Array.isArray(a.data)) return { ok: false, message: 'action.data must be an object.' };
  return { ok: true, action: { type: a.type, data: a.data as Record<string, unknown> } };
}

export async function runGateProgram(program: string, action: OutgoingAction, timeoutMs = GATE_TIMEOUT_MS): Promise<GateResult> {
  const silent = () => undefined;
  const context = vm.createContext({
    __action: JSON.stringify(action),
    console: { log: silent, info: silent, warn: silent, error: silent, debug: silent },
  });
  const wrapped = `(async () => {
    const action = JSON.parse(__action);
    const pass = () => ({ outcome: 'pass' });
    const block = (reason) => ({ outcome: 'block', reason: reason === undefined || reason === null ? '' : String(reason) });
${program}
  })()`;

  let timer: NodeJS.Timeout | undefined;
  try {
    const running = vm.runInContext(wrapped, context, { timeout: timeoutMs }) as Promise<unknown>;
    running.catch(() => undefined);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`The program did not finish within ${Math.round(timeoutMs / 1000)} seconds.`)), timeoutMs);
    });
    const result = (await Promise.race([running, timeout])) as { outcome?: unknown; reason?: unknown } | null;
    if (result && typeof result === 'object' && result.outcome === 'pass') return { outcome: 'pass' };
    if (result && typeof result === 'object' && result.outcome === 'block') {
      const reason = String(result.reason ?? '').slice(0, 500);
      return { outcome: 'block', reason: reason || 'Blocked by the pipe.' };
    }
    return { outcome: 'error', message: BAD_RETURN };
  } catch (err) {
    const thrown = err as { message?: unknown } | null;
    return { outcome: 'error', message: thrown && typeof thrown.message === 'string' ? thrown.message : String(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
