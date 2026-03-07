import { test, expect, describe } from "bun:test";
import { shellEscape, buildCommandWithEnv, isSubmenu, findAction } from "../actions.ts";
import type { MenuItem } from "../actions.ts";

describe("shellEscape", () => {
  test("simple string", () => {
    expect(shellEscape("hello")).toBe("'hello'");
  });

  test("string with single quotes", () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
  });

  test("string with double quotes", () => {
    expect(shellEscape('He said "hi"')).toBe("'He said \"hi\"'");
  });

  test("string with special shell characters", () => {
    expect(shellEscape("$HOME `cmd` $(pwd)")).toBe("'$HOME `cmd` $(pwd)'");
  });

  test("empty string", () => {
    expect(shellEscape("")).toBe("''");
  });

  test("string with multiple single quotes", () => {
    expect(shellEscape("it's a 'test'")).toBe("'it'\\''s a '\\''test'\\'''");
  });
});

describe("buildCommandWithEnv", () => {
  test("no variables", () => {
    expect(buildCommandWithEnv("echo hello", {})).toBe("echo hello");
  });

  test("single variable", () => {
    const result = buildCommandWithEnv('git commit -m "$MSG"', { MSG: "fix: bug" });
    expect(result).toBe("MSG='fix: bug' git commit -m \"$MSG\"");
  });

  test("multiple variables", () => {
    const result = buildCommandWithEnv("echo $A $B", { A: "hello", B: "world" });
    expect(result).toBe("A='hello' B='world' echo $A $B");
  });

  test("variable with special characters", () => {
    const result = buildCommandWithEnv('git commit -m "$MSG"', { MSG: "it's a \"fix\"" });
    expect(result).toBe("MSG='it'\\''s a \"fix\"' git commit -m \"$MSG\"");
  });

  test("built-in variables", () => {
    const result = buildCommandWithEnv("cd $CMUX_HUB_CWD && git status", {
      CMUX_HUB_CWD: "/home/user/project",
    });
    expect(result).toBe("CMUX_HUB_CWD='/home/user/project' cd $CMUX_HUB_CWD && git status");
  });
});

describe("isSubmenu", () => {
  test("action item", () => {
    const item: MenuItem = { label: "Commit", command: "git commit" };
    expect(isSubmenu(item)).toBe(false);
  });

  test("submenu item", () => {
    const item: MenuItem = {
      label: "More",
      submenu: [{ label: "Amend", command: "git commit --amend" }],
    };
    expect(isSubmenu(item)).toBe(true);
  });
});

describe("findAction", () => {
  const actions: MenuItem[] = [
    { label: "Commit", command: "git commit" },
    { label: "PR", command: "gh pr create" },
    {
      label: "More",
      submenu: [
        { label: "Amend", command: "git commit --amend" },
        { label: "Stash", command: "git stash" },
      ],
    },
  ];

  test("top-level action by index", () => {
    expect(findAction(actions, "0")).toEqual({ label: "Commit", command: "git commit" });
    expect(findAction(actions, "1")).toEqual({ label: "PR", command: "gh pr create" });
  });

  test("submenu action by index path", () => {
    expect(findAction(actions, "2.0")).toEqual({ label: "Amend", command: "git commit --amend" });
    expect(findAction(actions, "2.1")).toEqual({ label: "Stash", command: "git stash" });
  });

  test("returns null for submenu itself", () => {
    expect(findAction(actions, "2")).toBeNull();
  });

  test("returns null for out of range", () => {
    expect(findAction(actions, "5")).toBeNull();
    expect(findAction(actions, "2.5")).toBeNull();
    expect(findAction(actions, "-1")).toBeNull();
  });

  test("returns null for invalid id", () => {
    expect(findAction(actions, "abc")).toBeNull();
    expect(findAction(actions, "")).toBeNull();
  });
});
