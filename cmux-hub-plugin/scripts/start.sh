#!/bin/bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
USER_ACTIONS="${HOME}/.claude/cmux-hub.json"

# Copy default actions to user-level config if not present
if [ ! -f "$USER_ACTIONS" ]; then
  mkdir -p "${HOME}/.claude"
  cp "${PLUGIN_ROOT}/defaults/actions.json" "$USER_ACTIONS"
fi

# Project-local config takes priority over user-level config
if [ -f ".claude/cmux-hub.json" ]; then
  ACTIONS=".claude/cmux-hub.json"
else
  ACTIONS="$USER_ACTIONS"
fi

# Start cmux-hub in background so the hook returns immediately
# Redirect stdout/stderr so the hook runner doesn't wait for EOF
CMUX_HUB="${HOME}/.local/bin/cmux-hub"
"$CMUX_HUB" --actions "$ACTIONS" >/dev/null 2>&1 &
disown
