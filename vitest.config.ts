import { defineConfig } from 'vitest/config';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  test: {
    passWithNoTests: true,
    exclude: ['**/node_modules/**', 'dist/**', 'mobile/**'],
    // The CLI tests run `init` and `reset`, which write config.json and server.pid.
    // Point them at a scratch directory so a test run never touches the real ~/.pdh.
    env: { PDH_CONFIG_DIR: join(tmpdir(), `pdh-test-home-${process.pid}`, '.pdh') },
  },
});
