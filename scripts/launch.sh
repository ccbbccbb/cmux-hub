#!/bin/bash
# Launch cmux-hub with Terminal | Diff layout
# Usage: ./scripts/launch.sh [target_dir]

CMUX="/Applications/cmux.app/Contents/Resources/bin/cmux"
PORT="${CMUX_HUB_PORT:-4567}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Determine target directory
if [[ -n "$1" ]]; then
  TARGET_DIR="$1"
else
  # Use cmux focused pane's cwd if available
  TARGET_DIR=$("$CMUX" sidebar-state 2>/dev/null | awk -F= '/^focused_cwd=/{print $2}')
  if [[ -z "$TARGET_DIR" ]]; then
    TARGET_DIR="$(pwd)"
  fi
fi

cd "$TARGET_DIR" || exit 1

# Kill existing server on the port
kill_server() {
  lsof -ti:"$PORT" | xargs kill 2>/dev/null
}
trap kill_server EXIT INT TERM

# Notify via cmux
"$CMUX" notify --title "cmux-hub" --body "Loading diff: $TARGET_DIR" 2>/dev/null

# Start server
CMUX_HUB_CWD="$TARGET_DIR" PORT="$PORT" bun run "$PROJECT_DIR/src/index.ts" &
SERVER_PID=$!

# Wait for server
while ! curl -s "http://127.0.0.1:$PORT/api/status" > /dev/null 2>&1; do
  sleep 0.3
done

# Open browser split in cmux
BROWSER_SURFACE=$("$CMUX" --json browser open-split "http://127.0.0.1:$PORT" 2>/dev/null | grep -o '"ref" *: *"surface:[^"]*"' | head -1 | grep -o 'surface:[0-9]*')

if [[ -z "$BROWSER_SURFACE" ]]; then
  echo "cmux browser split not available, server running at http://127.0.0.1:$PORT"
  wait $SERVER_PID
  exit 0
fi

# Wait until browser surface is closed
while "$CMUX" surface-health 2>&1 | grep -q "$BROWSER_SURFACE"; do
  sleep 1
done

kill_server
