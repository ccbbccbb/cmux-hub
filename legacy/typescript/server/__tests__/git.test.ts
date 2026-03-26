import { test, expect, describe } from "bun:test";
import { createGitService, type CommandRunner } from "../git.ts";

function createFakeRunner(responses: Record<string, string>): CommandRunner {
  return async (cmd) => {
    const key = cmd.join(" ");
    for (const [pattern, response] of Object.entries(responses)) {
      if (key.includes(pattern)) return response;
    }
    throw new Error(`Unexpected command: ${key}`);
  };
}

describe("createGitService", () => {
  test("getDiff with base and target", async () => {
    const runner = createFakeRunner({
      "diff --unified=3 abc123...HEAD": "diff output here",
    });
    const git = createGitService(runner, "/tmp/test");
    const result = await git.getDiff("abc123", "HEAD");
    expect(result).toBe("diff output here");
  });

  test("getDiff with base only", async () => {
    const runner = createFakeRunner({
      "diff --unified=3 abc123": "diff from base",
    });
    const git = createGitService(runner, "/tmp/test");
    const result = await git.getDiff("abc123");
    expect(result).toBe("diff from base");
  });

  test("getDiff without args shows HEAD diff", async () => {
    const runner = createFakeRunner({
      "rev-parse HEAD": "abc123\n",
      "diff --unified=3 HEAD": "working diff",
    });
    const git = createGitService(runner, "/tmp/test");
    const result = await git.getDiff();
    expect(result).toBe("working diff");
  });

  test("getDiff without HEAD shows cached diff", async () => {
    const runner: CommandRunner = async (cmd) => {
      const key = cmd.join(" ");
      if (key.includes("rev-parse HEAD")) throw new Error("no HEAD");
      if (key.includes("diff --unified=3 --cached")) return "cached diff";
      throw new Error(`Unexpected: ${key}`);
    };
    const git = createGitService(runner, "/tmp/test");
    const result = await git.getDiff();
    expect(result).toBe("cached diff");
  });

  test("getDiffFiles parses file list", async () => {
    const runner = createFakeRunner({
      "rev-parse HEAD": "abc123\n",
      "diff --name-only HEAD": "src/index.ts\nREADME.md\n",
    });
    const git = createGitService(runner, "/tmp/test");
    const files = await git.getDiffFiles();
    expect(files).toEqual(["src/index.ts", "README.md"]);
  });

  test("getDiffFiles handles empty diff", async () => {
    const runner = createFakeRunner({
      "rev-parse HEAD": "abc123\n",
      "diff --name-only HEAD": "\n",
    });
    const git = createGitService(runner, "/tmp/test");
    const files = await git.getDiffFiles();
    expect(files).toEqual([]);
  });

  test("getCurrentBranch", async () => {
    const runner = createFakeRunner({
      "rev-parse --abbrev-ref HEAD": "feature/test\n",
    });
    const git = createGitService(runner, "/tmp/test");
    const branch = await git.getCurrentBranch();
    expect(branch).toBe("feature/test");
  });

  test("getCurrentBranch returns (no commits) when no HEAD", async () => {
    const runner: CommandRunner = async (_cmd) => {
      throw new Error("no HEAD");
    };
    const git = createGitService(runner, "/tmp/test");
    const branch = await git.getCurrentBranch();
    expect(branch).toBe("(no commits)");
  });

  test("getDefaultBranch from symbolic-ref", async () => {
    const runner = createFakeRunner({
      "symbolic-ref refs/remotes/origin/HEAD --short": "origin/main\n",
    });
    const git = createGitService(runner, "/tmp/test");
    const branch = await git.getDefaultBranch();
    expect(branch).toBe("origin/main");
  });

  test("getDefaultBranch fallback to origin/main", async () => {
    const runner: CommandRunner = async (cmd) => {
      const key = cmd.join(" ");
      if (key.includes("symbolic-ref")) {
        throw new Error("not found");
      }
      if (key.includes("rev-parse --verify origin/main")) {
        return "";
      }
      throw new Error(`Unexpected: ${key}`);
    };
    const git = createGitService(runner, "/tmp/test");
    const branch = await git.getDefaultBranch();
    expect(branch).toBe("origin/main");
  });

  test("getDefaultBranch returns null when no remote", async () => {
    const runner: CommandRunner = async (_cmd) => {
      throw new Error("not found");
    };
    const git = createGitService(runner, "/tmp/test");
    const branch = await git.getDefaultBranch();
    expect(branch).toBeNull();
  });

  test("getMergeBase", async () => {
    const runner = createFakeRunner({
      "merge-base HEAD origin/main": "abc123def\n",
    });
    const git = createGitService(runner, "/tmp/test");
    const base = await git.getMergeBase("HEAD", "origin/main");
    expect(base).toBe("abc123def");
  });

  test("getMergeBase returns null on failure", async () => {
    const runner: CommandRunner = async () => {
      throw new Error("no merge base");
    };
    const git = createGitService(runner, "/tmp/test");
    const base = await git.getMergeBase("HEAD", "origin/main");
    expect(base).toBeNull();
  });

  test("getBranches", async () => {
    const runner = createFakeRunner({
      "branch -a --format": "main\nfeature/x\norigin/main\n",
    });
    const git = createGitService(runner, "/tmp/test");
    const branches = await git.getBranches();
    expect(branches).toEqual(["main", "feature/x", "origin/main"]);
  });

  test("computeDiffRange on default branch", async () => {
    const runner: CommandRunner = async (cmd) => {
      const key = cmd.join(" ");
      if (key === "git rev-parse HEAD") return "abc123\n";
      if (key.includes("rev-parse --abbrev-ref HEAD")) return "main\n";
      if (key.includes("symbolic-ref")) return "origin/main\n";
      throw new Error(`Unexpected: ${key}`);
    };
    const git = createGitService(runner, "/tmp/test");
    const range = await git.computeDiffRange();
    expect(range.base).toBe("HEAD");
    expect(range.includeUntracked).toBe(true);
  });

  test("computeDiffRange on feature branch", async () => {
    const runner: CommandRunner = async (cmd) => {
      const key = cmd.join(" ");
      if (key === "git rev-parse HEAD") return "abc123\n";
      if (key.includes("rev-parse --abbrev-ref HEAD")) return "feature/x\n";
      if (key.includes("symbolic-ref")) return "origin/main\n";
      if (key.includes("merge-base")) return "abc123\n";
      throw new Error(`Unexpected: ${key}`);
    };
    const git = createGitService(runner, "/tmp/test");
    const range = await git.computeDiffRange();
    expect(range.base).toBe("abc123");
    expect(range.includeUntracked).toBe(false);
  });

  test("computeDiffRange with no HEAD returns --cached", async () => {
    const runner: CommandRunner = async (_cmd) => {
      throw new Error("no HEAD");
    };
    const git = createGitService(runner, "/tmp/test");
    const range = await git.computeDiffRange();
    expect(range.base).toBe("--cached");
    expect(range.includeUntracked).toBe(true);
  });

  test("passes cwd to command runner", async () => {
    let capturedCwd: string | undefined;
    const runner: CommandRunner = async (_cmd, options) => {
      capturedCwd = options?.cwd;
      return "main\n";
    };
    const git = createGitService(runner, "/my/project");
    await git.getCurrentBranch();
    expect(capturedCwd).toBe("/my/project");
  });
});
