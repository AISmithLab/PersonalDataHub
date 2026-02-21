import { describe, it, expect, vi } from 'vitest';
import plugin from './index.js';

describe('PersonalDataHub Plugin', () => {
  it('has correct plugin metadata', () => {
    expect(plugin.id).toBe('personal-data-hub');
    expect(plugin.name).toBe('Personal Data Hub');
    expect(plugin.description).toContain('Peekaboo');
  });

  it('config schema validates correct config', () => {
    const result = plugin.configSchema.safeParse({
      hubUrl: 'http://localhost:7007',
      apiKey: 'pk_test_123',
    });
    expect(result.success).toBe(true);
  });

  it('config schema rejects missing hubUrl', () => {
    const result = plugin.configSchema.safeParse({
      apiKey: 'pk_test_123',
    });
    expect(result.success).toBe(false);
  });

  it('config schema rejects missing apiKey', () => {
    const result = plugin.configSchema.safeParse({
      hubUrl: 'http://localhost:7007',
    });
    expect(result.success).toBe(false);
  });

  it('config schema rejects non-object', () => {
    const result = plugin.configSchema.safeParse('not an object');
    expect(result.success).toBe(false);
  });

  it('registers tools when config is valid', () => {
    const registerTool = vi.fn();
    const on = vi.fn();
    const api = {
      pluginConfig: {
        hubUrl: 'http://localhost:7007',
        apiKey: 'pk_test_123',
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerTool,
      on,
    };

    plugin.register(api);

    expect(registerTool).toHaveBeenCalledTimes(2);

    // Verify pull tool
    const pullTool = registerTool.mock.calls[0][0];
    expect(pullTool.name).toBe('personal_data_pull');

    // Verify propose tool
    const proposeTool = registerTool.mock.calls[1][0];
    expect(proposeTool.name).toBe('personal_data_propose');

    // Verify hook registration
    expect(on).toHaveBeenCalledWith('before_agent_start', expect.any(Function));
  });

  it('warns and skips registration when config is missing', () => {
    const registerTool = vi.fn();
    const on = vi.fn();
    const api = {
      pluginConfig: undefined,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerTool,
      on,
    };

    plugin.register(api);

    expect(registerTool).not.toHaveBeenCalled();
    expect(api.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Missing hubUrl or apiKey'),
    );
  });

  it('before_agent_start hook returns system prompt', async () => {
    const on = vi.fn();
    const api = {
      pluginConfig: {
        hubUrl: 'http://localhost:7007',
        apiKey: 'pk_test_123',
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerTool: vi.fn(),
      on,
    };

    plugin.register(api);

    // Get the registered hook handler
    const hookCall = on.mock.calls.find((c: unknown[]) => c[0] === 'before_agent_start');
    expect(hookCall).toBeDefined();

    const handler = hookCall![1] as (event: unknown) => Promise<{ systemPromptAppend: string }>;
    const result = await handler({});
    expect(result.systemPromptAppend).toContain('Peekaboo');
    expect(result.systemPromptAppend).toContain('personal_data_pull');
    expect(result.systemPromptAppend).toContain('personal_data_propose');
  });
});
