#!/usr/bin/env bash
# Pushes a minimal valid Android config to the device.
# OAuth credentials are baked into the APK at compile time — no credentials needed here.
set -e

PKG="com.aismithlab.pdh"
REMOTE="/data/data/$PKG/files/pdh-data/hub-config.yaml"

# Try to preserve the existing encryption_key so stored tokens remain valid
ENC_KEY=$(adb shell "run-as $PKG sh -c 'cat $REMOTE 2>/dev/null'" 2>/dev/null \
  | grep "^encryption_key:" | head -1 \
  | sed "s/encryption_key:[[:space:]]*['\"]\\?//;s/['\"]\\?[[:space:]]*$//" || true)

if [ -z "$ENC_KEY" ]; then
  ENC_KEY=$(node -e "console.log(require('crypto').randomUUID())")
  echo "Generated new encryption_key."
else
  echo "Preserved existing encryption_key: ${ENC_KEY:0:8}..."
fi

printf 'deployment:\n  database: sqljs\n\nencryption_key: "%s"\n\nsources:\n  gmail:\n    enabled: true\n  google_calendar:\n    enabled: true\n  github:\n    enabled: true\n\nport: 3000\n' \
  "$ENC_KEY" \
  | adb shell "run-as $PKG sh -c 'cat > $REMOTE'"

echo "Done. Force-stop the app and reopen."
