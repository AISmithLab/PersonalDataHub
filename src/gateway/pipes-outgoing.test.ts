import { describe, it, expect } from 'vitest';
import { checkAction, runGateProgram, ACTION_TYPES, OUTGOING_SOURCES, type OutgoingAction } from './pipes-outgoing.js';

const STUDENTS = `
const students = ["alice@ucsd.edu", "bob@ucsd.edu"];
if (action.type !== "send_email" && action.type !== "draft_email") return block("Only emails and drafts.");
const to = String(action.data.to).toLowerCase().split(/[,;]/).map((r) => r.trim());
const outside = to.filter((r) => !students.includes(r));
if (outside.length) return block("Not a lab student: " + outside.join(", "));
return pass();`;
const email = (to: string): OutgoingAction => ({ type: 'send_email', data: { to, subject: 'Letter submitted', body: 'Done.' } });

describe('checkAction', () => {
  it('accepts the action types of each source', () => {
    expect(OUTGOING_SOURCES).toEqual(['gmail', 'google_calendar']);
    expect(ACTION_TYPES.gmail).toEqual(['send_email', 'reply_email', 'draft_email']);
    expect(ACTION_TYPES.google_calendar).toEqual(['create_event', 'update_event', 'delete_event']);
    expect(checkAction('gmail', email('alice@ucsd.edu'))).toEqual({ ok: true, action: email('alice@ucsd.edu') });
  });

  it('passes data on as the agent sent it', () => {
    const r = checkAction('gmail', { type: 'send_email', data: { to: 'A@x.org', cc: 'b@y.org' } });
    expect(r).toEqual({ ok: true, action: { type: 'send_email', data: { to: 'A@x.org', cc: 'b@y.org' } } });
  });

  it('rejects an unknown type for the source, an unknown source, and a malformed action', () => {
    expect(checkAction('gmail', { type: 'create_event', data: {} }).ok).toBe(false);
    expect(checkAction('github', { type: 'send_email', data: {} }).ok).toBe(false);
    for (const bad of [null, 'send', {}, { type: 'send_email' }, { type: 'send_email', data: 'x' }, { type: 5, data: {} }]) {
      expect(checkAction('gmail', bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('runGateProgram', () => {
  it('passes and blocks with the program\'s reason', async () => {
    expect(await runGateProgram(STUDENTS, email('alice@ucsd.edu'))).toEqual({ outcome: 'pass' });
    expect(await runGateProgram(STUDENTS, email('dean@ucsd.edu'))).toEqual({ outcome: 'block', reason: 'Not a lab student: dean@ucsd.edu' });
  });

  it('an empty block reason gets a default, and a long one is cut to 500 characters', async () => {
    expect(await runGateProgram('return block();', email('a@b.c'))).toEqual({ outcome: 'block', reason: 'Blocked by the pipe.' });
    const r = await runGateProgram('return block("x".repeat(900));', email('a@b.c'));
    expect(r.outcome === 'block' && r.reason.length).toBe(500);
  });

  it('anything but pass() or block() is an error', async () => {
    for (const program of ['return true;', 'return "pass";', 'return;']) {
      expect(await runGateProgram(program, email('a@b.c')), program).toEqual({ outcome: 'error', message: 'The program must return pass() or block(reason).' });
    }
  });

  it('throws, never settles, and an endless loop are errors', async () => {
    expect(await runGateProgram('throw new Error("boom");', email('a@b.c'))).toEqual({ outcome: 'error', message: 'boom' });
    expect((await runGateProgram('await new Promise(() => {});', email('a@b.c'), 300)).outcome).toBe('error');
    expect((await runGateProgram('while (true) {}', email('a@b.c'), 300)).outcome).toBe('error');
  });

  it('has no ask, require, fetch, process or timers', async () => {
    for (const name of ['ask', 'require', 'fetch', 'process', 'setTimeout']) {
      expect(await runGateProgram(`return typeof ${name} === "undefined" ? pass() : block("${name} exists");`, email('a@b.c')), name).toEqual({ outcome: 'pass' });
    }
  });

  it('cannot reach the hub process through anything in its scope', async () => {
    const probes = [
      'console.log.constructor("return typeof process")()',
      'pass.constructor("return typeof process")()',
      'block.constructor("return typeof process")()',
      'action.constructor.constructor("return typeof process")()',
    ];
    for (const probe of probes) {
      const r = await runGateProgram(`let t; try { t = ${probe}; } catch (e) { t = "undefined"; } return t === "undefined" ? pass() : block(t);`, email('a@b.c'));
      expect(r, probe).toEqual({ outcome: 'pass' });
    }
  });

  it('the program gets a copy', async () => {
    const action = email('alice@ucsd.edu');
    await runGateProgram('action.data.to = "x@y.z"; return pass();', action);
    expect(action.data.to).toBe('alice@ucsd.edu');
  });
});
