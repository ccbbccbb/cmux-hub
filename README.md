# cmux-hub (Rust rewrite)

`cmux-hub` is now a Rust-first implementation focused on speed and stability.

## Repository layout

- `src/`: Rust backend (CLI, git integration, API, WebSocket server)
- `web/`: Static frontend served by the Rust server
- `legacy/typescript/`: Archived pre-Rust TypeScript implementation, including the original README and migration reference materials

## Build

```bash
cargo build --release
```

## Run

```bash
cargo run -- --port 4567 --actions .claude/cmux-hub.json .
```

## API surface

- `GET /api/health`
- `GET /api/status`
- `GET /api/diff/auto`
- `GET /api/commits`
- `GET /api/actions`
- `GET /api/state`
- `GET /ws`

## Web quality checks

```bash
npm install
npm run lint:web
npm run typecheck:web
```

## Notes

- The archived TypeScript README is available at: `legacy/typescript/README.md`.
