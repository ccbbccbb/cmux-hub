import type { CommandRunner } from "./git.ts";

export type GitHubService = ReturnType<typeof createGitHubService>;

type PRInfo = {
  number: number;
  title: string;
  state: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  body: string;
};

type PRComment = {
  id: number;
  body: string;
  user: string;
  path: string;
  line: number;
  createdAt: string;
  updatedAt: string;
};

type CICheck = {
  name: string;
  status: string;
  conclusion: string;
  url: string;
};

export function createGitHubService(run: CommandRunner, cwd: string) {
  const gh = (args: string[]) => run(["gh", ...args], { cwd });

  return {
    async getCurrentPR(): Promise<PRInfo | null> {
      try {
        const raw = await gh([
          "pr", "view", "--json",
          "number,title,state,url,headRefName,baseRefName,body",
        ]);
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },

    async getPRComments(prNumber: number): Promise<PRComment[]> {
      try {
        const raw = await gh([
          "api",
          `repos/{owner}/{repo}/pulls/${prNumber}/comments`,
          "--jq",
          ".[] | {id: .id, body: .body, user: .user.login, path: .path, line: .line, createdAt: .created_at, updatedAt: .updated_at}",
        ]);
        if (!raw.trim()) return [];
        return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      } catch {
        return [];
      }
    },

    async getPRReviewComments(prNumber: number): Promise<PRComment[]> {
      try {
        const raw = await gh([
          "api",
          `repos/{owner}/{repo}/pulls/${prNumber}/reviews`,
          "--jq",
          ".[] | {id: .id, body: .body, user: .user.login, state: .state}",
        ]);
        if (!raw.trim()) return [];
        return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      } catch {
        return [];
      }
    },

    async getCIChecks(): Promise<CICheck[]> {
      try {
        const raw = await gh([
          "pr", "checks", "--json",
          "name,state,conclusion,detailsUrl",
        ]);
        const checks = JSON.parse(raw);
        return checks.map((c: Record<string, string>) => ({
          name: c.name,
          status: c.state,
          conclusion: c.conclusion,
          url: c.detailsUrl,
        }));
      } catch {
        return [];
      }
    },

    /**
     * Build gh pr create command string (to be sent to terminal via cmux)
     */
    buildCreatePRCommand(title: string, body?: string): string {
      const args = ["gh", "pr", "create", "--title", JSON.stringify(title)];
      if (body) {
        args.push("--body", JSON.stringify(body));
      }
      return args.join(" ");
    },

    /**
     * Build git commit command string (to be sent to terminal via cmux)
     */
    buildCommitCommand(message: string): string {
      return `git commit -m ${JSON.stringify(message)}`;
    },
  };
}
