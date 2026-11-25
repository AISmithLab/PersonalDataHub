/**
 * Hub discovery and setup utilities.
 *
 * Used by the skill to detect a running PersonalDataHub.
 * All communication is over HTTP — no dependency on the main
 * PersonalDataHub source.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface HealthCheckResult {
  ok: boolean;
  version?: string;
}

export interface HubConfig {
  hubUrl: string;
  /** The agent's token, from its registration with the hub. */
  apiKey?: string;
}

/**
 * The token file written by `query-hub join` when this agent registered with a
 * hub: { hub, token, agent_name, agent_id }. Same location query-hub uses.
 */
export const CONFIG_PATH = process.env.QUERY_HUB_CONFIG || join(homedir(), '.pdh', 'agent.json');

/**
 * Read the agent's registration. Returns null if this agent has not joined a hub
 * (no file) or the file is malformed.
 */
export function readConfig(): HubConfig | null {
  try {
    if (!existsSync(CONFIG_PATH)) return null;
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    if (typeof parsed.hub === 'string' && typeof parsed.token === 'string') {
      return { hubUrl: parsed.hub, apiKey: parsed.token };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a PersonalDataHub is reachable at the given URL.
 * Hits GET /health and returns the result.
 */
export async function checkHub(hubUrl: string, timeoutMs = 3000): Promise<HealthCheckResult> {
  const url = hubUrl.replace(/\/+$/, '');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`${url}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { ok: false };
    }

    const body = await res.json() as { ok?: boolean; version?: string };
    return {
      ok: body.ok === true,
      version: body.version,
    };
  } catch {
    return { ok: false };
  }
}

/** Common default hub URLs to probe during discovery. */
export const DEFAULT_HUB_URLS = [
  'http://localhost:3000',
  'http://localhost:7007',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:7007',
];

/**
 * Try to discover a running PersonalDataHub by probing common URLs.
 * Returns the first URL that responds to /health, or null.
 */
export async function discoverHub(): Promise<string | null> {
  for (const url of DEFAULT_HUB_URLS) {
    const result = await checkHub(url, 2000);
    if (result.ok) {
      return url;
    }
  }
  return null;
}
