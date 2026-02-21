/**
 * PersonalDataHub — OpenClaw extension for interacting with Peekaboo.
 *
 * Registers tools that let the agent pull personal data and propose
 * outbound actions through the Peekaboo privacy gateway.
 */

import { HubClient } from './hub-client.js';
import { createPullTool, createProposeTool } from './tools.js';
import { PERSONAL_DATA_SYSTEM_PROMPT } from './prompts.js';

export interface PersonalDataHubPluginConfig {
  hubUrl: string;
  apiKey: string;
}

export default {
  id: 'personal-data-hub',
  name: 'Personal Data Hub',
  description: 'Unified interface to personal data through Peekaboo privacy gateway',

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
      if (!cfg.apiKey || typeof cfg.apiKey !== 'string') {
        return {
          success: false as const,
          error: { issues: [{ path: ['apiKey'], message: 'apiKey is required and must be a string' }] },
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
      required: ['hubUrl', 'apiKey'],
    },
  },

  register(api: {
    pluginConfig?: Record<string, unknown>;
    logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
    registerTool: (tool: unknown) => void;
    on: (hook: string, handler: (event: unknown) => Promise<unknown>) => void;
  }) {
    const config = api.pluginConfig as PersonalDataHubPluginConfig | undefined;

    if (!config?.hubUrl || !config?.apiKey) {
      api.logger.warn(
        'PersonalDataHub: Missing hubUrl or apiKey in plugin config. Tools will not be registered.',
      );
      return;
    }

    const client = new HubClient({
      hubUrl: config.hubUrl,
      apiKey: config.apiKey,
    });

    api.logger.info(`PersonalDataHub: Registering tools (hub: ${config.hubUrl})`);

    // Register the two tools
    api.registerTool(createPullTool(client));
    api.registerTool(createProposeTool(client));

    // Inject system prompt before agent starts
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
