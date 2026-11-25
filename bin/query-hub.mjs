#!/usr/bin/env node
// query-hub — the agent's client for a PersonalDataHub.
//
// An agent registers once with a join link the hub's owner makes in
// Settings → Agents, and from then on reads data and proposes actions through
// this command. The agent's token lives in a file only this command reads; it is
// never printed, so it stays out of the agent's conversation and logs.
//
// This file has no dependencies and is the source copy. smithagent carries a copy
// of it (Lab-AI-Infra/smithagent/bin/query-hub); change it here and copy it there.

import { readFileSync, writeFileSync, existsSync, lstatSync, mkdirSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const VERSION = '1';

const USAGE = `query-hub — read from and propose actions to a PersonalDataHub

  query-hub join <join-link> --name <agent-name>   register with a hub (the owner makes the link in Settings → Agents)
  query-hub me                                     this agent's name and what it may do
  query-hub sources                                the sources it may read, and whether each is connected
  query-hub pull <source> --purpose <why> [--query <search>] [--limit <n>]
  query-hub propose <source> <action-type> --purpose <why> --data '<json>'
  query-hub leave                                  remove this agent from the hub and delete its token

Sources: gmail, google_calendar, github, photo.
Every pull and propose needs --purpose; the hub records it in the owner's audit log.
Proposed actions are not carried out until the owner approves them in the hub.

The token file is $QUERY_HUB_CONFIG, or ~/.pdh/agent.json. Output is JSON on stdout.`;

class Fail extends Error {}

// The agent's token, once known, so it can be scrubbed from anything we print.
let secret = null;
const scrub = (text) => (secret ? String(text).split(secret).join('<token>') : String(text));

function tokenFile() {
  return process.env.QUERY_HUB_CONFIG || join(homedir(), '.pdh', 'agent.json');
}

function loadAgent() {
  const file = tokenFile();
  if (!existsSync(file)) {
    throw new Fail(`Not registered with a hub (no ${file}). Ask the hub's owner for a join link, then run: query-hub join <join-link> --name <agent-name>`);
  }
  let agent;
  try {
    agent = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Fail(`${file} is not valid JSON. Delete it and join again.`);
  }
  if (!agent || typeof agent.hub !== 'string' || typeof agent.token !== 'string' || !agent.hub || !agent.token) {
    throw new Fail(`${file} has no hub or token. Delete it and join again.`);
  }
  secret = agent.token;
  return agent;
}

// Splits argv into positional arguments and --flags. Every flag takes a value.
function parseArgs(argv, known) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (!known.includes(name)) throw new Fail(`Unknown option --${name}.`);
      const value = argv[++i];
      if (value === undefined || value === '' || value.startsWith('--')) throw new Fail(`--${name} needs a value.`);
      flags[name] = value;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function request(hub, path, { method = 'GET', token, body } = {}) {
  let res;
  try {
    res = await fetch(hub + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Fail(`The hub is not running at ${hub}. Ask the owner to start it (npx pdh start).`);
  }
  let json = null;
  try {
    json = await res.json();
  } catch { /* not JSON */ }
  return { status: res.status, json };
}

function describe(json, status) {
  const e = json && json.error;
  if (e && typeof e === 'object' && e.message) return e.message;
  if (typeof e === 'string') return e;
  return `The hub answered ${status}.`;
}

// For calls made as a registered agent.
async function call(path, options = {}) {
  const agent = loadAgent();
  const { status, json } = await request(agent.hub, path, { ...options, token: agent.token });
  if (status === 401) {
    throw new Fail(`This agent ("${agent.agent_name}") is no longer registered with the hub at ${agent.hub}: it was revoked. Ask the owner for a new join link, run "query-hub leave" to clear the old token, then join again.`);
  }
  if (status === 403 && json?.error?.permission) {
    throw new Fail(`Not allowed: this agent lacks the "${json.error.permission}" permission. The hub's owner can grant it in Settings → Agents.`);
  }
  if (status >= 400) throw new Fail(describe(json, status));
  return json;
}

// A join link is <hub>/agent/join/<code>. The code is a credential, so it only
// goes to this machine over http, or to any host over https.
function parseJoinLink(link) {
  const bad = new Fail('That is not a hub join link. It should look like http://127.0.0.1:3000/agent/join/<code>.');
  let url;
  try { url = new URL(link); } catch { throw bad; }
  const match = /^\/agent\/join\/([0-9a-f]+)\/?$/.exec(url.pathname);
  if (!match || url.username || url.password || url.search || url.hash) throw bad;
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol === 'http:' ? !local : url.protocol !== 'https:') {
    throw new Fail(`Refusing to send the join code to ${url.host} over plain http. A hub on another machine must use https.`);
  }
  return { hub: url.origin, code: match[1] };
}

function print(value) {
  process.stdout.write(scrub(JSON.stringify(value, null, 2)) + '\n');
}

const commands = {
  async join(argv) {
    const { positional, flags } = parseArgs(argv, ['name']);
    const link = positional[0];
    if (!link || !flags.name) throw new Fail('Usage: query-hub join <join-link> --name <agent-name>');
    const { hub, code } = parseJoinLink(link);

    const file = tokenFile();
    // lstat, not exists: a dangling symlink at this path must count as "something is here".
    let occupied = true;
    try { lstatSync(file); } catch { occupied = false; }
    if (occupied) {
      let current = 'another agent';
      try { current = `"${JSON.parse(readFileSync(file, 'utf8')).agent_name}"`; } catch { /* unreadable */ }
      throw new Fail(`Already registered as ${current} (${file}). Run "query-hub leave" first, or set QUERY_HUB_CONFIG to another file for a second agent.`);
    }

    // Reserve the token file before spending the link. The hub hands the token over
    // exactly once; if we could not save it, the agent would be registered and lost.
    // 'wx' creates the file only if nothing is there, and never follows a symlink.
    try {
      mkdirSync(dirname(file), { recursive: true });
      closeSync(openSync(file, 'wx', 0o600));
    } catch (err) {
      throw new Fail(`Cannot write the token file ${file} (${err.code || err.message}). The join link was not used.`);
    }

    let joined;
    try {
      const { status, json } = await request(hub, '/agent/join', { method: 'POST', body: { code, name: flags.name } });
      if (status !== 201 || !json || typeof json.token !== 'string') throw new Fail(describe(json, status));
      joined = json;
      secret = json.token;
      writeFileSync(file, JSON.stringify({ hub, token: json.token, agent_name: json.agent_name, agent_id: json.agent_id }, null, 2) + '\n', { mode: 0o600 });
    } catch (err) {
      try { unlinkSync(file); } catch { /* nothing to clean up */ }
      throw err;
    }
    const json = joined;
    print({ ok: true, joined: json.agent_name, hub, permissions: json.permissions, token_file: file });
  },

  async me() {
    print(await call('/agent/me'));
  },

  async sources() {
    print(await call('/agent/sources'));
  },

  async pull(argv) {
    const { positional, flags } = parseArgs(argv, ['purpose', 'query', 'limit']);
    const source = positional[0];
    if (!source || !flags.purpose) throw new Fail('Usage: query-hub pull <source> --purpose <why> [--query <search>] [--limit <n>]');
    const body = { source, purpose: flags.purpose };
    if (flags.query !== undefined) body.query = flags.query;
    if (flags.limit !== undefined) {
      const limit = Number(flags.limit);
      if (!Number.isInteger(limit) || limit < 1) throw new Fail('--limit must be a positive whole number.');
      body.limit = limit;
    }
    print(await call('/agent/pull', { method: 'POST', body }));
  },

  async propose(argv) {
    const { positional, flags } = parseArgs(argv, ['purpose', 'data']);
    const [source, actionType] = positional;
    if (!source || !actionType || !flags.purpose) throw new Fail("Usage: query-hub propose <source> <action-type> --purpose <why> --data '<json>'");
    let data = {};
    if (flags.data !== undefined) {
      try {
        data = JSON.parse(flags.data);
      } catch {
        throw new Fail('--data must be valid JSON, for example \'{"to":"a@b.c","subject":"Hi","body":"..."}\'.');
      }
    }
    print(await call('/agent/propose', { method: 'POST', body: { source, action_type: actionType, action_data: data, purpose: flags.purpose } }));
  },

  async leave() {
    const file = tokenFile();
    const agent = loadAgent();
    // Tell the hub if it is reachable; the local token is deleted either way.
    let hubSide = 'removed';
    try {
      const { status } = await request(agent.hub, '/agent/leave', { method: 'POST', token: agent.token });
      if (status === 401) hubSide = 'already revoked';
      else if (status >= 400) hubSide = `not removed (hub answered ${status})`;
    } catch {
      hubSide = 'not reached; revoke this agent in Settings → Agents';
    }
    unlinkSync(file);
    print({ ok: true, left: agent.agent_name, hub: agent.hub, at_hub: hubSide });
  },
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(USAGE + '\n');
    return;
  }
  if (command === 'version' || command === '--version') {
    process.stdout.write(`query-hub ${VERSION}\n`);
    return;
  }
  const run = Object.hasOwn(commands, command) ? commands[command] : null;
  if (!run) throw new Fail(`Unknown command "${command}".\n\n${USAGE}`);
  await run(rest);
}

main().catch((err) => {
  process.stderr.write(`query-hub: ${scrub(err instanceof Fail ? err.message : (err && err.stack) || err)}\n`);
  process.exit(1);
});
