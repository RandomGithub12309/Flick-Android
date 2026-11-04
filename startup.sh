#!/bin/sh
set -eu
# The workspace root is wherever this script lives: /workspace in the App
# Builder sandbox, this checkout's root after a clone. Hardcoding either one
# breaks the revive in the other — and with `set -eu` a failed cd here aborts
# the whole script, so the preview quietly never comes back.
cd "$(dirname "$0")"

# :8081 is QA-only — a revive must never inherit a stale built-output preview.
node scripts/preview.mjs stop || true

# The committed node_modules was vendored on Windows and carries no Linux
# native bindings, and node_modules is not part of the workspace snapshot — so
# after a revive, vite dies at import on "Cannot find native binding" before it
# ever reaches the app. Best-effort and offline-tolerant; never fails the boot.
node scripts/ensure-native-bindings.mjs || true

if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
npm run dev >>/tmp/app-startup.log 2>&1 &
