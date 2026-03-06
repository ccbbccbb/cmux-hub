import type { ServerWebSocket } from "bun";
import type { GitService } from "./git.ts";
import type { CmuxService } from "./cmux.ts";
import type { GitHubService } from "./github.ts";
import {
  validateRequest,
  securityHeaders,
  corsHeaders,
  isValidWebSocketOrigin,
} from "./middleware/security.ts";
import { parseDiff } from "../src/lib/diff-parser.ts";
import { highlightDiffFiles } from "./diff-highlight.ts";

type AppDeps = {
  port: number;
  git: GitService;
  cmux: CmuxService;
  github: GitHubService;
  cwd: string;
  defaultSurfaceId?: string;
  /** When true, return undefined from fetch for unmatched routes (needed for Bun dev server asset serving) */
  development?: boolean;
  /** Shutdown the process when all WebSocket clients disconnect */
  autoShutdownMs?: number;
  watcher?: {
    start(): void;
    onChanged(cb: () => void): void;
    stop(): void;
  };
};

/**
 * Build route handlers, WebSocket config, and fetch handler.
 * The caller is responsible for calling `serve()` with the returned config
 * so that Bun's HTML bundler resolves asset paths correctly.
 */
export function createAppConfig(deps: AppDeps) {
  const { port, git, cmux, github, cwd, defaultSurfaceId } = deps;
  const securityConfig = { port };

  function resolveSurfaceId(surfaceId?: string): string | undefined {
    return surfaceId ?? defaultSurfaceId;
  }

  const wsClients = new Set<ServerWebSocket<unknown>>();
  let hasHadClients = false;
  let shutdownTimer: ReturnType<typeof setTimeout> | null = null;

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      try {
        const pr = await github.getCurrentPR();
        if (!pr) return;
        const checks = await github.getCIChecks();
        const comments = await github.getPRComments(pr.number);
        const message = JSON.stringify({
          type: "pr-updated",
          data: { pr, checks, comments },
        });
        for (const ws of wsClients) {
          ws.send(message);
        }
      } catch {
        // ignore polling errors
      }
    }, 10000);
  }

  function addSecurityHeaders(response: Response): Response {
    const headers = { ...securityHeaders(), ...corsHeaders(securityConfig) };
    for (const [key, value] of Object.entries(headers)) {
      response.headers.set(key, value);
    }
    return response;
  }

  function jsonResponse(data: unknown, status = 200): Response {
    return addSecurityHeaders(Response.json(data, { status }));
  }

  function errorResponse(message: string, status = 500): Response {
    return jsonResponse({ error: message }, status);
  }

  const apiRoutes: Record<string, unknown> = {
    "/api/diff": {
      async GET(req: Request) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const url = new URL(req.url);
          const base = url.searchParams.get("base") ?? undefined;
          const target = url.searchParams.get("target") ?? undefined;
          const raw = await git.getDiff(base, target);
          const files = await highlightDiffFiles(parseDiff(raw));
          return jsonResponse({ diff: raw, files });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/diff/auto": {
      async GET(req: Request) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const range = await git.computeDiffRange();
          const raw = await git.getDiff(range.base);
          const files = await highlightDiffFiles(parseDiff(raw));
          return jsonResponse({ diff: raw, files, base: range.base, includeUntracked: range.includeUntracked });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/diff/files": {
      async GET(req: Request) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const url = new URL(req.url);
          const base = url.searchParams.get("base") ?? undefined;
          const target = url.searchParams.get("target") ?? undefined;
          const files = await git.getDiffFiles(base, target);
          return jsonResponse({ files });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/file-lines": {
      async GET(req: Request) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const url = new URL(req.url);
          const path = url.searchParams.get("path");
          const start = parseInt(url.searchParams.get("start") ?? "1", 10);
          const end = parseInt(url.searchParams.get("end") ?? "1", 10);
          if (!path) return errorResponse("path required", 400);
          const lines = await git.getFileLines(path, start, end);
          return jsonResponse({ lines });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/branches": {
      async GET(req: Request) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const branches = await git.getBranches();
          const current = await git.getCurrentBranch();
          return jsonResponse({ branches, current });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/status": {
      async GET(req: Request) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const status = await git.getStatus();
          const branch = await git.getCurrentBranch();
          return jsonResponse({ status, branch, cwd, terminalSurface: defaultSurfaceId ?? null });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/send-to-terminal": {
      async POST(req: Request) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const body = await req.json() as { text: string; surfaceId?: string };
          await cmux.sendText(body.text, resolveSurfaceId(body.surfaceId));
          return jsonResponse({ ok: true });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/comment": {
      async POST(req: Request) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const body = await req.json() as {
            file: string;
            startLine: number;
            endLine: number;
            comment: string;
            surfaceId?: string;
          };
          await cmux.sendComment(body.file, body.startLine, body.endLine, body.comment, resolveSurfaceId(body.surfaceId));
          return jsonResponse({ ok: true });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/command": {
      async POST(req: Request) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const body = await req.json() as { command: string; surfaceId?: string };
          await cmux.sendCommand(body.command, resolveSurfaceId(body.surfaceId));
          return jsonResponse({ ok: true });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/commit": {
      async POST(req: Request) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const body = await req.json() as { message: string; surfaceId?: string };
          const command = github.buildCommitCommand(body.message);
          await cmux.sendCommand(command, resolveSurfaceId(body.surfaceId));
          return jsonResponse({ ok: true, command });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/pr/create": {
      async POST(req: Request) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const body = await req.json() as { title: string; body?: string; surfaceId?: string };
          const command = github.buildCreatePRCommand(body.title, body.body);
          await cmux.sendCommand(command, resolveSurfaceId(body.surfaceId));
          return jsonResponse({ ok: true, command });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/pr": {
      async GET(req: Request) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const pr = await github.getCurrentPR();
          return jsonResponse({ pr });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/pr/comments": {
      async GET(req: Request) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const pr = await github.getCurrentPR();
          if (!pr) return jsonResponse({ comments: [] });
          const comments = await github.getPRComments(pr.number);
          return jsonResponse({ comments });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/ci": {
      async GET(req: Request) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const checks = await github.getCIChecks();
          return jsonResponse({ checks });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/review/start": {
      async POST(req: Request) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const body = await req.json() as { prompt?: string; surfaceId?: string };
          const prompt = body.prompt ?? "このPRの変更をレビューしてください";
          const command = `claude "${prompt}"`;
          await cmux.sendCommand(command, resolveSurfaceId(body.surfaceId));
          return jsonResponse({ ok: true, command });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },
  };

  // upgradeServer must be set by the caller after serve() returns
  let upgradeServer: { upgrade(req: Request, opts: { data: unknown }): boolean } | null = null;

  return {
    apiRoutes,

    setServer(server: { upgrade(req: Request, opts: { data: unknown }): boolean }) {
      upgradeServer = server;
    },

    websocket: {
      open(ws: ServerWebSocket<unknown>) {
        wsClients.add(ws);
        hasHadClients = true;
        if (shutdownTimer) {
          clearTimeout(shutdownTimer);
          shutdownTimer = null;
        }
        startPolling();
      },
      message(_ws: ServerWebSocket<unknown>, _message: string | Buffer) {
        // No client→server messages expected yet
      },
      close(ws: ServerWebSocket<unknown>) {
        wsClients.delete(ws);
        if (wsClients.size === 0) {
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
          // Auto-shutdown when all clients disconnect
          if (hasHadClients && deps.autoShutdownMs !== undefined) {
            shutdownTimer = setTimeout(() => {
              console.log("All clients disconnected, shutting down.");
              process.exit(0);
            }, deps.autoShutdownMs);
          }
        }
      },
    },

    fetch(req: Request) {
      const url = new URL(req.url);

      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders(securityConfig),
        });
      }

      // WebSocket upgrade
      if (url.pathname === "/ws") {
        if (!isValidWebSocketOrigin(req, securityConfig)) {
          return new Response("Forbidden: invalid origin", { status: 403 });
        }
        if (upgradeServer) {
          const upgraded = upgradeServer.upgrade(req, { data: {} });
          if (!upgraded) {
            return new Response("WebSocket upgrade failed", { status: 400 });
          }
        }
        return undefined;
      }

      if (url.pathname === "/favicon.ico") {
        return new Response(null, { status: 204 });
      }

      // In dev mode, return undefined so Bun's dev server can serve compiled assets.
      // In production/compiled mode, assets are embedded in routes, so return 404.
      if (deps.development) return undefined;
      return new Response("Not Found", { status: 404 });
    },

    startWatcher() {
      if (deps.watcher) {
        deps.watcher.start();
        deps.watcher.onChanged(() => {
          const message = JSON.stringify({ type: "diff-updated" });
          for (const ws of wsClients) {
            ws.send(message);
          }
        });
      }
    },

    stop() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      deps.watcher?.stop();
    },
  };
}
