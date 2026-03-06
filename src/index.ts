import { serve, type ServerWebSocket } from "bun";
import index from "./index.html";
import { createGitService, defaultCommandRunner } from "../server/git.ts";
import { createCmuxService, createSocketConnector } from "../server/cmux.ts";
import { createGitHubService } from "../server/github.ts";
import { createFileWatcher, defaultWatcherFactory } from "../server/watcher.ts";
import {
  validateRequest,
  securityHeaders,
  corsHeaders,
  isValidWebSocketOrigin,
} from "../server/middleware/security.ts";

const PORT = parseInt(process.env.PORT ?? "4567", 10);
const CWD = process.env.CMUX_HUB_CWD ?? process.cwd();

const git = createGitService(defaultCommandRunner, CWD);
const cmux = createCmuxService(createSocketConnector());
const github = createGitHubService(defaultCommandRunner, CWD);
const watcher = createFileWatcher(defaultWatcherFactory, CWD);

const securityConfig = { port: PORT };

// WebSocket clients
const wsClients = new Set<ServerWebSocket<unknown>>();

// Start file watcher
watcher.start();
watcher.onChanged(() => {
  const message = JSON.stringify({ type: "diff-updated" });
  for (const ws of wsClients) {
    ws.send(message);
  }
});

// CI/PR polling
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

serve({
  port: PORT,
  hostname: "127.0.0.1",

  routes: {
    "/api/diff": {
      async GET(req) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const url = new URL(req.url);
          const base = url.searchParams.get("base") ?? undefined;
          const target = url.searchParams.get("target") ?? undefined;
          const diff = await git.getDiff(base, target);
          return jsonResponse({ diff });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/diff/auto": {
      async GET(req) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const range = await git.computeDiffRange();
          const diff = await git.getDiff(range.base);
          return jsonResponse({ diff, base: range.base, includeUntracked: range.includeUntracked });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/diff/files": {
      async GET(req) {
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

    "/api/branches": {
      async GET(req) {
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
      async GET(req) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const status = await git.getStatus();
          const branch = await git.getCurrentBranch();
          return jsonResponse({ status, branch, cwd: CWD });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/send-to-terminal": {
      async POST(req) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const body = await req.json() as { text: string; surfaceId?: string };
          await cmux.sendText(body.text, body.surfaceId);
          return jsonResponse({ ok: true });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/comment": {
      async POST(req) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const body = await req.json() as {
            file: string;
            line: number;
            comment: string;
            surfaceId?: string;
          };
          await cmux.sendComment(body.file, body.line, body.comment, body.surfaceId);
          return jsonResponse({ ok: true });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/command": {
      async POST(req) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const body = await req.json() as { command: string; surfaceId?: string };
          await cmux.sendCommand(body.command, body.surfaceId);
          return jsonResponse({ ok: true });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/commit": {
      async POST(req) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const body = await req.json() as { message: string; surfaceId?: string };
          const command = github.buildCommitCommand(body.message);
          await cmux.sendCommand(command, body.surfaceId);
          return jsonResponse({ ok: true, command });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/pr/create": {
      async POST(req) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const body = await req.json() as { title: string; body?: string; surfaceId?: string };
          const command = github.buildCreatePRCommand(body.title, body.body);
          await cmux.sendCommand(command, body.surfaceId);
          return jsonResponse({ ok: true, command });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    "/api/pr": {
      async GET(req) {
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
      async GET(req) {
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
      async GET(req) {
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
      async POST(req) {
        const secErr = validateRequest(req, securityConfig);
        if (secErr) return secErr;
        try {
          const body = await req.json() as { prompt?: string; surfaceId?: string };
          const prompt = body.prompt ?? "このPRの変更をレビューしてください";
          const command = `claude "${prompt}"`;
          await cmux.sendCommand(command, body.surfaceId);
          return jsonResponse({ ok: true, command });
        } catch (e) {
          return errorResponse(e instanceof Error ? e.message : "Unknown error");
        }
      },
    },

    // Serve frontend for all other routes
    "/*": index,
  },

  websocket: {
    open(ws) {
      wsClients.add(ws);
      startPolling();
    },
    message(_ws, _message) {
      // No client→server messages expected yet
    },
    close(ws) {
      wsClients.delete(ws);
      if (wsClients.size === 0 && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    },
  },

  fetch(req, server) {
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
      const upgraded = server.upgrade(req);
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return undefined;
    }

    // Routes are handled by the routes config above
    return undefined;
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`Server running at http://127.0.0.1:${PORT}`);
console.log(`Watching: ${CWD}`);
