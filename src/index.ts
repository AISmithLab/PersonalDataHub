import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './config/loader.js';
import { startServer } from './gateway/server.js';
import { createApp } from './app.js';

const configPath = process.argv[2] ?? resolve('hub-config.yaml');

if (!existsSync(configPath)) {
  console.log('PersonalDataHub v0.1.0');
  console.log(`\nNo config file found at: ${configPath}`);
  console.log("Run 'npx pdh init' to get started.");
  process.exit(1);
}

// Settings changed in the GUI (the AI key and model) are written back to this file.
process.env.PDH_CONFIG_PATH ??= configPath;

const config = loadConfig(configPath);
const { store, connectorRegistry, tokenManager } = await createApp(config);
startServer({ store, connectorRegistry, config, tokenManager });
