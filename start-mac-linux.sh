#!/bin/sh
# Runs Pear Drops from source on macOS or Linux: installs what it needs the first
# time, switches on login encryption, then starts the app.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Pear Drops needs Node.js 24 or newer: https://nodejs.org" >&2
  exit 1
fi
# First run, or an update changed the app engine (the updater leaves .needs-install).
if [ ! -d node_modules/electron ] || [ -f .needs-install ]; then
  echo "Installing…"
  npm install --no-fund --no-audit || exit 1
  rm -f .needs-install
fi
node scripts/harden.js
nohup npx electron . >/dev/null 2>&1 &
