#!/bin/bash
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ACTIONS=".claude/cmux-hub.json"

# Copy default actions if not present
if [ ! -f "$ACTIONS" ]; then
  mkdir -p .claude
  cp "${PLUGIN_ROOT}/defaults/actions.json" "$ACTIONS"
fi

# Start cmux-hub in background so the hook returns immediately
CMUX_HUB="${HOME}/.local/bin/cmux-hub"
"$CMUX_HUB" --actions "$ACTIONS" &
