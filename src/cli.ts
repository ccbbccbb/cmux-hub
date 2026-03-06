#!/usr/bin/env bun
import { serve } from "bun";
import { parseArgs } from "util";
import index from "./index.html";
import { createGitService, defaultCommandRunner } from "../server/git.ts";
import { createCmuxService, createSocketConnector, createDryRunConnector } from "../server/cmux.ts";
import { createGitHubService } from "../server/github.ts";
import { createFileWatcher, defaultWatcherFactory } from "../server/watcher.ts";
import { createAppConfig } from "../server/app.ts";

const CMUX_BIN = "/Applications/cmux.app/Contents/Resources/bin/cmux";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    port: { type: "string", short: "p", default: process.env.PORT ?? "4567" },
    "dry-run": { type: "boolean", default: process.env.CMUX_HUB_DRY_RUN === "true" },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(`cmux-hub - Diff viewer for cmux

Usage: cmux-hub [options] [target_dir]

Options:
  -p, --port <port>   Server port (default: 4567)
  --dry-run           Don't connect to cmux socket
  -h, --help          Show this help

Examples:
  cmux-hub                     # Use current directory
  cmux-hub /path/to/project    # Specify target directory
  cmux-hub --dry-run            # Development mode`);
  process.exit(0);
}

const PORT = parseInt(values.port ?? "4567", 10);
const DRY_RUN = values["dry-run"] ?? false;
const TERMINAL_SURFACE = process.env.CMUX_SURFACE_ID ?? undefined;

// Determine target directory
async function resolveTargetDir(): Promise<string> {
  if (positionals.length > 0) {
    return positionals[0]!;
  }

  // Try cmux sidebar-state for focused pane cwd
  try {
    const proc = Bun.spawn([CMUX_BIN, "sidebar-state"], { stdout: "pipe", stderr: "pipe" });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    const match = /^focused_cwd=(.+)$/m.exec(output);
    if (match?.[1]) return match[1];
  } catch {
    // cmux not available
  }

  return process.cwd();
}

const CWD = await resolveTargetDir();

// Notify via cmux
try {
  Bun.spawn([CMUX_BIN, "notify", "--title", "cmux-hub", "--body", `Loading diff: ${CWD}`], {
    stderr: "pipe",
  });
} catch {
  // cmux not available
}

const git = createGitService(defaultCommandRunner, CWD);
const connector = DRY_RUN ? createDryRunConnector() : createSocketConnector();
const cmux = createCmuxService(connector);
const github = createGitHubService(defaultCommandRunner, CWD);
const watcher = createFileWatcher(defaultWatcherFactory, CWD);

const app = createAppConfig({
  port: PORT,
  git,
  cmux,
  github,
  cwd: CWD,
  watcher,
  defaultSurfaceId: TERMINAL_SURFACE,
  autoShutdownMs: DRY_RUN ? undefined : 3000,
});

const server = serve({
  port: PORT,
  hostname: "127.0.0.1",
  routes: {
    ...app.apiRoutes,
    "/": index,
  },
  websocket: app.websocket,
  fetch: app.fetch,
  development: false,
});

app.setServer(server);
app.startWatcher();

console.log(`Server running at http://127.0.0.1:${PORT}`);
console.log(`Watching: ${CWD}`);

// Wait for server to be ready before opening browser
async function waitForReady() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/status`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await Bun.sleep(100);
  }
}
await waitForReady();

// Open browser split in cmux
async function openBrowserSplit(): Promise<string | null> {
  try {
    const proc = Bun.spawn(
      [CMUX_BIN, "--json", "browser", "open-split", `http://127.0.0.1:${PORT}`],
      { stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) return null;

    // Extract surface ref from JSON output
    const match = /"ref"\s*:\s*"(surface:\d+)"/.exec(output);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function isSurfaceAlive(surfaceRef: string): Promise<boolean> {
  try {
    const proc = Bun.spawn([CMUX_BIN, "surface-health"], { stdout: "pipe", stderr: "pipe" });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    return output.includes(surfaceRef);
  } catch {
    return false;
  }
}

async function waitForBrowserClose(surfaceRef: string) {
  while (await isSurfaceAlive(surfaceRef)) {
    await Bun.sleep(1000);
  }
  console.log("Browser closed, shutting down.");
  process.exit(0);
}

const browserSurface = await openBrowserSplit();
if (browserSurface) {
  waitForBrowserClose(browserSurface);
} else {
  console.log("cmux browser split not available, open http://127.0.0.1:" + PORT);
}
