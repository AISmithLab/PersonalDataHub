/**
 * PersonalDataHub — OpenClaw skill for interacting with PersonalDataHub.
 *
 * Registers tools that let the agent pull personal data and propose
 * outbound actions through the PersonalDataHub access control gateway.
 *
 * Config resolution order:
 *   1. Plugin config (hubUrl passed directly)
 *   2. Environment variable (PDH_HUB_URL)
 *   3. The agent's registration file (~/.pdh/agent.json, written by `query-hub join`)
 *   4. Auto-discovery (probe localhost)
 */

import { HubClient } from './hub-client.js';
import { createPullTool, createProposeTool } from './tools.js';
import { PERSONAL_DATA_SYSTEM_PROMPT } from './prompts.js';
import { discoverHub, readConfig } from './setup.js';

export interface PersonalDataHubPluginConfig {
  hubUrl: string;
  apiKey?: string;
}

export default {
  id: 'personaldatahub',
  name: 'Personal Data Hub',
  description: 'Unified interface to personal data through PersonalDataHub access control gateway',

  configSchema: {
    safeParse(value: unknown) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {
          success: false as const,
          error: { issues: [{ path: [], message: 'expected config object' }] },
        };
      }
      const cfg = value as Record<string, unknown>;
      if (!cfg.hubUrl || typeof cfg.hubUrl !== 'string') {
        return {
          success: false as const,
          error: { issues: [{ path: ['hubUrl'], message: 'hubUrl is required and must be a string' }] },
        };
      }
      return { success: true as const, data: value };
    },
    jsonSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        hubUrl: { type: 'string' },
        apiKey: { type: 'string' },
      },
      required: ['hubUrl'],
    },
  },

  async register(api: {
    pluginConfig?: Record<string, unknown>;
    logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
    registerTool: (tool: unknown) => void;
    on: (hook: string, handler: (event: unknown) => Promise<unknown>) => void;
  }) {
    let config = api.pluginConfig as PersonalDataHubPluginConfig | undefined;

    // Step 2: Check environment variable
    if (!config?.hubUrl) {
      const envHubUrl = process.env.PDH_HUB_URL;
      if (envHubUrl) {
        config = { hubUrl: envHubUrl, apiKey: process.env.PDH_API_KEY };
        api.logger.info(`PersonalDataHub: Configured from environment variables (hub: ${envHubUrl})`);
      }
    }

    // Step 3: Check the agent's registration (written by `query-hub join`)
    if (!config?.hubUrl) {
      const cfg = readConfig();
      if (cfg) {
        config = { hubUrl: cfg.hubUrl, apiKey: cfg.apiKey };
        api.logger.info(`PersonalDataHub: Configured from the agent's registration (hub: ${cfg.hubUrl})`);
      }
    }

    // Step 4: Auto-discovery — probe localhost
    if (!config?.hubUrl) {
      api.logger.info('PersonalDataHub: Config incomplete, attempting auto-discovery...');

      try {
        const hubUrl = await discoverHub();
        if (hubUrl) {
          config = { hubUrl };
          api.logger.info(`PersonalDataHub: Discovered hub at ${hubUrl}`);
        }
      } catch (err) {
        api.logger.warn(
          `PersonalDataHub: Auto-discovery failed: ${(err as Error).message}`,
        );
      }
    }

    if (!config?.hubUrl) {
      api.logger.warn(
        'PersonalDataHub: This agent is not registered with a hub.\n' +
        '  Ask the hub\'s owner for a join link (Settings → Agents), then run:\n' +
        '    query-hub join <link> --name <name>\n' +
        '  and restart the agent. Or configure manually: { "hubUrl": "http://localhost:3000", "apiKey": "<token>" }',
      );
      return;
    }

    // The token may be in the registration file even when hubUrl came from elsewhere.
    const apiKey = config.apiKey ?? process.env.PDH_API_KEY ?? readConfig()?.apiKey;
    if (!apiKey) {
      api.logger.warn(
        'PersonalDataHub: This agent is not registered with the hub. Calls will be rejected with 401.\n' +
        '  Ask the owner for a join link (Settings → Agents), then run: query-hub join <link> --name <name>',
      );
    }

    const client = new HubClient({
      hubUrl: config.hubUrl,
      apiKey,
    });

    api.logger.info(`PersonalDataHub: Registering tools (hub: ${config.hubUrl})`);

    api.registerTool(createPullTool(client));
    api.registerTool(createProposeTool(client));

    api.on('before_agent_start', async (_event: unknown) => {
      return { systemPromptAppend: PERSONAL_DATA_SYSTEM_PROMPT };
    });
  },
};

// Re-export for direct usage
export { HubClient, HubApiError } from './hub-client.js';
export type { HubClientConfig, PullParams, ProposeParams, PullResult, ProposeResult } from './hub-client.js';
export { createPullTool, createProposeTool } from './tools.js';
export { PERSONAL_DATA_SYSTEM_PROMPT } from './prompts.js';
export { checkHub, discoverHub, readConfig } from './setup.js';
