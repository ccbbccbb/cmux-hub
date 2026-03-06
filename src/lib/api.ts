const BASE_URL = "";

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getDiff(base?: string, target?: string) {
    const params = new URLSearchParams();
    if (base) params.set("base", base);
    if (target) params.set("target", target);
    const qs = params.toString();
    return fetchJSON<{ diff: string; files?: import("./diff-parser.ts").ParsedDiff }>(`/api/diff${qs ? `?${qs}` : ""}`);
  },

  getAutoDiff() {
    return fetchJSON<{ diff: string; files?: import("./diff-parser.ts").ParsedDiff; base: string; includeUntracked: boolean }>("/api/diff/auto");
  },

  getDiffFiles(base?: string, target?: string) {
    const params = new URLSearchParams();
    if (base) params.set("base", base);
    if (target) params.set("target", target);
    const qs = params.toString();
    return fetchJSON<{ files: string[] }>(`/api/diff/files${qs ? `?${qs}` : ""}`);
  },

  getFileLines(path: string, start: number, end: number) {
    const params = new URLSearchParams({ path, start: String(start), end: String(end) });
    return fetchJSON<{ lines: string[] }>(`/api/file-lines?${params}`);
  },

  getBranches() {
    return fetchJSON<{ branches: string[]; current: string }>("/api/branches");
  },

  getStatus() {
    return fetchJSON<{ status: string; branch: string; cwd: string; terminalSurface: string | null }>("/api/status");
  },

  sendToTerminal(text: string, surfaceId?: string) {
    return fetchJSON<{ ok: boolean }>("/api/send-to-terminal", {
      method: "POST",
      body: JSON.stringify({ text, surfaceId }),
    });
  },

  sendComment(file: string, startLine: number, endLine: number, comment: string, surfaceId?: string) {
    return fetchJSON<{ ok: boolean }>("/api/comment", {
      method: "POST",
      body: JSON.stringify({ file, startLine, endLine, comment, surfaceId }),
    });
  },

  sendCommand(command: string, surfaceId?: string) {
    return fetchJSON<{ ok: boolean }>("/api/command", {
      method: "POST",
      body: JSON.stringify({ command, surfaceId }),
    });
  },

  commit(message: string, surfaceId?: string) {
    return fetchJSON<{ ok: boolean; command: string }>("/api/commit", {
      method: "POST",
      body: JSON.stringify({ message, surfaceId }),
    });
  },

  createPR(title: string, body?: string, surfaceId?: string) {
    return fetchJSON<{ ok: boolean; command: string }>("/api/pr/create", {
      method: "POST",
      body: JSON.stringify({ title, body, surfaceId }),
    });
  },

  getPR() {
    return fetchJSON<{ pr: unknown }>("/api/pr");
  },

  getPRComments() {
    return fetchJSON<{ comments: unknown[] }>("/api/pr/comments");
  },

  getCI() {
    return fetchJSON<{ checks: unknown[] }>("/api/ci");
  },

  startReview(prompt?: string, surfaceId?: string) {
    return fetchJSON<{ ok: boolean; command: string }>("/api/review/start", {
      method: "POST",
      body: JSON.stringify({ prompt, surfaceId }),
    });
  },
};
