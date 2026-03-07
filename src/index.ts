import { serve } from "bun";
import index from "./index.html";
import { createGitService, defaultCommandRunner } from "../server/git.ts";
import { createCmuxService, createSocketConnector, createDryRunConnector } from "../server/cmux.ts";
import { createGitHubService } from "../server/github.ts";
import { createFileWatcher, defaultWatcherFactory } from "../server/watcher.ts";
import { createAppConfig } from "../server/app.ts";
import { DEFAULT_ACTIONS } from "../server/actions.ts";

const PORT = parseInt(process.env.PORT ?? "4567", 10);
const CWD = process.env.CMUX_HUB_CWD ?? process.cwd();
const DRY_RUN = process.env.CMUX_HUB_DRY_RUN === "true";
const TERMINAL_SURFACE = process.env.CMUX_HUB_TERMINAL_SURFACE ?? undefined;

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
  development: process.env.NODE_ENV !== "production",
  defaultSurfaceId: TERMINAL_SURFACE,
  autoShutdownMs: DRY_RUN ? undefined : 3000,
  actions: DEFAULT_ACTIONS,
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

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

app.setServer(server);
app.startWatcher();

console.log(`Server running at http://127.0.0.1:${PORT}`);
console.log(`Watching: ${CWD}`);
