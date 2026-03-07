# cmux-hub

A diff viewer for [cmux](https://cmux.dev). Displays branch changes with inline comments, commit, PR creation, and custom toolbar actions.

## Install

```bash
bun install
```

## Usage

### Development

```bash
bun dev
```

### CLI (binary)

```bash
# Build
bun run build:compile

# Run (diff of current directory)
./cmux-hub

# Specify target directory
./cmux-hub /path/to/project

# Custom toolbar actions
./cmux-hub --actions actions.json

# Read actions from stdin
cat actions.json | ./cmux-hub --actions -

# Inline actions via heredoc
./cmux-hub --actions - <<'EOF'
[
  { "label": "Commit", "type": "shell", "command": "git commit -m \"$MSG\"", "input": { "placeholder": "Commit message...", "variable": "MSG" } },
  { "label": "Push", "type": "shell", "command": "git push" }
]
EOF
```

### Options

```
-p, --port <port>      Server port (default: 4567)
-a, --actions <file>   Toolbar actions JSON file (use - for stdin)
--dry-run              Don't connect to cmux socket
--debug                Enable debug logging (also: DEBUG=*)
-h, --help             Show help
```

## Custom Actions

Pass a JSON file via `--actions` to customize toolbar buttons.
Without it, the default Commit / Create PR / AI Review actions are shown.

### Action Definition

```json
[
  {
    "label": "Commit",
    "type": "shell",
    "command": "git commit -m \"$MSG\"",
    "input": { "placeholder": "Commit message...", "variable": "MSG" }
  },
  {
    "label": "Create PR",
    "type": "shell",
    "command": "gh pr create --title \"$TITLE\"",
    "input": { "placeholder": "PR title...", "variable": "TITLE" }
  },
  {
    "label": "AI Review",
    "type": "terminal",
    "command": "claude \"Review this PR\" --allowedTools bash"
  },
  {
    "label": "More",
    "submenu": [
      { "label": "Amend", "type": "shell", "command": "git commit --amend --no-edit" },
      { "label": "Stash", "type": "shell", "command": "git stash" }
    ]
  }
]
```

### Action Fields

| Field | Type | Description |
|-------|------|-------------|
| `label` | `string` | Button label |
| `command` | `string` | Command to execute |
| `type` | `"shell" \| "terminal" \| "text"` | Execution mode (see below). Default: `"shell"` |
| `input` | `{ placeholder, variable }` | Shows an input form before executing |
| `submenu` | `ActionItem[]` | Nested menu (instead of `command`) |

### Execution Modes

| type | Behavior | Use case |
|------|----------|----------|
| `"shell"` | Executes as a subshell on the server. Returns stdout/stderr/exitCode | `git commit`, `gh pr create` |
| `"terminal"` | Sends command to cmux terminal (with Enter) | Commands for Claude Code or other terminal processes |
| `"text"` | Sends text to cmux terminal (without Enter) | Paste text only |

### Variables

Commands can reference shell variables. Variables are prepended as inline environment variables (env prefix).

#### Built-in Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `$CMUX_HUB_CWD` | Target directory (absolute path) | `/home/user/project` |
| `$CMUX_HUB_GIT_BRANCH` | Current git branch | `feat/new-feature` |
| `$CMUX_HUB_GIT_BASE` | Diff base branch (auto-detected) | `main` |
| `$CMUX_HUB_PORT` | Server port | `4567` |
| `$CMUX_HUB_SURFACE_ID` | cmux terminal surface ID | `surface:123` |

#### User Input Variables

Variables defined in `input.variable` are set as environment variables from user input.

```json
{ "command": "git commit -m \"$MSG\"", "input": { "variable": "MSG" } }
```

#### Safety

Variable values are single-quote escaped and prepended as env prefix. Shell injection does not occur.

```
Template:  git commit -m "$MSG"
Input:     fix: it's a "bug"
Executed:  MSG='fix: it'\''s a "bug"' git commit -m "$MSG"
```

The `/api/action` endpoint only accepts an action ID and user input variables — it does not accept raw command strings.

## Development

```bash
bun test          # Run tests
bun run lint      # Lint
bun run fmt       # Format
bun run typecheck # Type check
bun run test:e2e  # E2E tests
```

## Tech Stack

- Runtime: Bun
- Frontend: React + Tailwind CSS + shadcn/ui
- Syntax Highlighting: Shiki
- cmux communication: Unix domain socket (`/tmp/cmux.sock`) via JSON-RPC
- git: `Bun.spawn` with git CLI
- GitHub: `gh` CLI
