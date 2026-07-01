# PersonalDataHub — Android Build Guide

How to build and run the Android app.

## Architecture

The Android app uses **React Native** with `nodejs-mobile-react-native` to run the existing Hono backend in a native background thread:

```
┌─────────────────────────────────────────────────────┐
│  Android App                                        │
│  ┌───────────────────┐   ┌───────────────────────┐  │
│  │  React Native     │   │  nodejs-mobile-       │  │
│  │  WebView          │◄──│  react-native         │  │
│  │                   │   │  (background thread)  │  │
│  │  Loads            │   │                       │  │
│  │  127.0.0.1:3000   │   │  src/android.ts       │  │
│  │                   │   │  Hono server          │  │
│  └───────────────────┘   │  sql.js DataStore     │  │
│                          └───────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

`nodejs-mobile-react-native` bundles Node.js as a native library and starts `android.js` (compiled from `src/android.ts`) in a background thread at app launch. The Hono server runs on `127.0.0.1:3000`. `better-sqlite3` is replaced by `sql.js` (pure JS + WASM) since native modules cannot be loaded inside the Node.js Mobile thread.

The backend is pre-bundled at build time by `scripts/bundle-mobile.cjs` using esbuild; it is placed in `mobile/nodejs-assets/nodejs-project/` which `nodejs-mobile-react-native` copies into the APK.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 22 | Use nvm: `nvm install 22` |
| npm | bundled with Node | Used inside `mobile/` |
| Android Studio | Ladybug (2024.2)+ | [developer.android.com/studio](https://developer.android.com/studio) |
| Android SDK | API 26+ (Android 8) | Via Android Studio → SDK Manager |
| JDK | 17 or 21 | Bundled with Android Studio, or `sdk install java 21-tem` |
| ADB | any | Bundled with Android SDK platform-tools |

Set `ANDROID_HOME` before building (add to your shell profile):

```bash
# Linux
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools

# macOS
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

If `ANDROID_HOME` is not set but the SDK is at the default location, the build scripts will find it automatically.

---

## Step 1 — Install dependencies

From the repo root:

```bash
npm install
```

From the `mobile/` directory:

```bash
cd mobile && npm install
```

---

## Step 2 — Build and run

```bash
cd mobile
npm run build:android
```

This does three things in sequence:

1. **`setup:android`** — creates `mobile/android/local.properties` pointing at your Android SDK (skipped if the file already exists)
2. **`bundle:node`** — compiles `src/android.ts` (and `src/ios.ts`) with esbuild, outputs to `mobile/nodejs-assets/nodejs-project/`, copies the sql.js WASM files
3. **`react-native run-android`** — starts Metro, builds the APK with Gradle, and deploys to the connected device or emulator

Gradle downloads dependencies on the first run — this takes several minutes. Subsequent builds are faster.

---

## Step 3 — Connect a device or emulator

`react-native run-android` requires either a physical device or a running emulator.

**Physical device:** Enable Developer Options and USB Debugging, then connect via USB. Verify with:

```bash
adb devices
```

**Emulator:** Open Android Studio → Device Manager → start a virtual device, then run `npm run build:android`.

---

## Rebuild after backend changes

When you edit any TypeScript in `src/`:

```bash
# From the repo root — rebuilds the desktop CLI
npm run build

# From mobile/ — re-bundles the Node.js backend for Android and redeploys
npm run build:android
```

You do **not** need to rebuild the Node.js bundle for React Native UI changes (`mobile/App.tsx` and friends) — Metro handles those with Fast Refresh.

---

## Run Metro separately (development workflow)

For faster iteration on the React Native UI:

```bash
# Terminal 1 — start Metro bundler
cd mobile && npm start

# Terminal 2 — deploy to device (uses running Metro)
cd mobile && npm run android
```

This skips the Node.js bundle step. Use `npm run build:android` when you also have backend changes.

---

## Troubleshooting

### `SDK location not found`

The `mobile/android/local.properties` file is missing or `ANDROID_HOME` is not set.

Run the setup script manually:

```bash
cd mobile && npm run setup:android
```

Or create the file manually:

```bash
echo "sdk.dir=$HOME/Android/Sdk" > mobile/android/local.properties   # Linux
echo "sdk.dir=$HOME/Library/Android/sdk" > mobile/android/local.properties  # macOS
```

### `INSTALL_FAILED_UPDATE_INCOMPATIBLE`

The device has an existing installation signed with a different debug key. Uninstall it:

```bash
adb uninstall com.personaldatahub
```

Then re-run `npm run build:android`.

### `react-native: command not found`

Run `npm install` inside `mobile/` first:

```bash
cd mobile && npm install
```

### `better-sqlite3` fails to build (`npm install` in repo root)

`better-sqlite3` requires Node.js ≤ 24 to find prebuilt binaries. On Node.js 26+ it builds from source. If the build fails, upgrade to the latest `better-sqlite3`:

```bash
npm install better-sqlite3@latest
```

The `mobile/` app does not use `better-sqlite3` — it uses `sql.js` (pure JS, no native build).

### Metro bundler port conflict

If port 8081 is in use, start Metro on a different port:

```bash
cd mobile && npm start -- --port 8082
```

---

## Environment variables (backend thread)

These are set by `src/android.ts` at runtime inside the Node.js Mobile thread:

| Variable | Purpose |
|----------|---------|
| `PDH_MOBILE=true` | Selects sql.js DataStore instead of better-sqlite3 |
| `PDH_DB_PATH` | Path to the on-device SQLite database file |
| `PDH_DATA_DIR` | Directory for database + config |
| `PDH_CONFIG_PATH` | Path to `hub-config.yaml` on the device |
| `PDH_ENCRYPTION_KEY` | Master key for OAuth token encryption |
| `SQLJS_WASM_PATH` | Path to `sql-wasm.wasm` (auto-set from `__dirname`) |

OAuth credentials (`__GMAIL_CLIENT_ID__`, etc.) are embedded at compile time by `scripts/bundle-mobile.cjs` from `hub-config.yaml`.

---

## Building a release APK

1. Generate a release keystore (one-time):

```bash
keytool -genkeypair -v -storetype PKCS12 \
  -keystore mobile/android/app/release.keystore \
  -alias pdh-release -keyalg RSA -keysize 2048 -validity 10000
```

2. Add signing config to `mobile/android/app/build.gradle` under `signingConfigs`:

```groovy
release {
    storeFile file('release.keystore')
    storePassword System.getenv('PDH_STORE_PASSWORD')
    keyAlias 'pdh-release'
    keyPassword System.getenv('PDH_KEY_PASSWORD')
}
```

3. Update the `release` buildType to use `signingConfigs.release`.

4. Build:

```bash
cd mobile/android && ./gradlew assembleRelease
```

The APK is at `mobile/android/app/build/outputs/apk/release/app-release.apk`.
