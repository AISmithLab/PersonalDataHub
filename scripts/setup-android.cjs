#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
const androidDir = path.join(root, 'mobile', 'android');
const propertiesFile = path.join(androidDir, 'local.properties');

// Resolve Android SDK Path
let sdkPath = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;

if (!sdkPath) {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    sdkPath = path.join(home, 'Library', 'Android', 'sdk');
  } else if (process.platform === 'win32') {
    sdkPath = path.join(home, 'AppData', 'Local', 'Android', 'Sdk');
  } else {
    sdkPath = path.join(home, 'Android', 'Sdk');
  }
}

// Convert Windows paths to escape backslashes for local.properties
let escapedSdkPath = sdkPath;
if (process.platform === 'win32') {
  escapedSdkPath = sdkPath.replace(/\\/g, '/');
}

console.log(`[setup-android] Resolved Android SDK path to: ${sdkPath}`);

if (!fs.existsSync(sdkPath)) {
  console.warn(`[setup-android] WARNING: Android SDK path does not exist at ${sdkPath}. Please install the Android SDK or set ANDROID_HOME.`);
}

try {
  fs.mkdirSync(androidDir, { recursive: true });
  fs.writeFileSync(propertiesFile, `sdk.dir=${escapedSdkPath}\n`, 'utf8');
  console.log(`[setup-android] Successfully wrote sdk.dir to ${propertiesFile}`);
} catch (err) {
  console.error('[setup-android] Failed to write local.properties:', err);
  process.exit(1);
}
