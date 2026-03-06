import { test, expect, describe } from "bun:test";
import { parseDiff } from "../lib/diff-parser.ts";

const SAMPLE_DIFF = `diff --git a/src/index.ts b/src/index.ts
index abc1234..def5678 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,5 +1,6 @@
 import { serve } from "bun";
+import { newModule } from "./new";

 const server = serve({
-  port: 3000,
+  port: 4567,
   routes: {`;

const NEW_FILE_DIFF = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,3 @@
+export function newModule() {
+  return "hello";
+}`;

const DELETED_FILE_DIFF = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index abc1234..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export function old() {
-}`;

const MNEMONIC_PREFIX_DIFF = `diff --git c/package.json w/package.json
index 9b5f005..2d79530 100644
--- c/package.json
+++ w/package.json
@@ -4,7 +4,7 @@
   "private": true,
   "type": "module",
   "scripts": {
-    "dev": "bun --hot src/index.ts",
+    "dev": "CMUX_HUB_DRY_RUN=true bun --hot src/index.ts",
     "start": "NODE_ENV=production bun src/index.ts",`;

const MULTI_FILE_DIFF = `${SAMPLE_DIFF}

${NEW_FILE_DIFF}`;

describe("parseDiff", () => {
  test("parses a basic diff", () => {
    const result = parseDiff(SAMPLE_DIFF);
    expect(result).toHaveLength(1);
    expect(result[0]?.oldPath).toBe("src/index.ts");
    expect(result[0]?.newPath).toBe("src/index.ts");
    expect(result[0]?.isNew).toBe(false);
    expect(result[0]?.isDeleted).toBe(false);
  });

  test("parses hunks correctly", () => {
    const result = parseDiff(SAMPLE_DIFF);
    const file = result[0];
    expect(file?.hunks).toHaveLength(1);

    const hunk = file?.hunks[0];
    expect(hunk?.oldStart).toBe(1);
    expect(hunk?.oldCount).toBe(5);
    expect(hunk?.newStart).toBe(1);
    expect(hunk?.newCount).toBe(6);
  });

  test("parses line types correctly", () => {
    const result = parseDiff(SAMPLE_DIFF);
    const lines = result[0]?.hunks[0]?.lines ?? [];

    const contextLines = lines.filter((l) => l.type === "context");
    const addLines = lines.filter((l) => l.type === "add");
    const deleteLines = lines.filter((l) => l.type === "delete");

    expect(contextLines.length).toBe(3);
    expect(addLines.length).toBe(2);
    expect(deleteLines.length).toBe(1);
  });

  test("tracks line numbers correctly", () => {
    const result = parseDiff(SAMPLE_DIFF);
    const lines = result[0]?.hunks[0]?.lines ?? [];

    // First context line: old=1, new=1
    expect(lines[0]?.oldLineNumber).toBe(1);
    expect(lines[0]?.newLineNumber).toBe(1);

    // Added line: old=null, new=2
    expect(lines[1]?.type).toBe("add");
    expect(lines[1]?.oldLineNumber).toBeNull();
    expect(lines[1]?.newLineNumber).toBe(2);

    // Deleted line: old=3, new=null
    const deletedLine = lines.find((l) => l.type === "delete");
    expect(deletedLine?.oldLineNumber).not.toBeNull();
    expect(deletedLine?.newLineNumber).toBeNull();
  });

  test("detects new file", () => {
    const result = parseDiff(NEW_FILE_DIFF);
    expect(result[0]?.isNew).toBe(true);
    expect(result[0]?.newPath).toBe("src/new.ts");
  });

  test("detects deleted file", () => {
    const result = parseDiff(DELETED_FILE_DIFF);
    expect(result[0]?.isDeleted).toBe(true);
  });

  test("parses multiple files", () => {
    const result = parseDiff(MULTI_FILE_DIFF);
    expect(result).toHaveLength(2);
    expect(result[0]?.newPath).toBe("src/index.ts");
    expect(result[1]?.newPath).toBe("src/new.ts");
  });

  test("parses mnemonic prefix (c/w/) diff", () => {
    const result = parseDiff(MNEMONIC_PREFIX_DIFF);
    expect(result).toHaveLength(1);
    expect(result[0]?.newPath).toBe("package.json");
    expect(result[0]?.hunks).toHaveLength(1);
    const addLines = result[0]?.hunks[0]?.lines.filter((l) => l.type === "add") ?? [];
    expect(addLines.length).toBe(1);
    expect(addLines[0]?.content).toContain("CMUX_HUB_DRY_RUN");
  });

  test("handles empty diff", () => {
    const result = parseDiff("");
    expect(result).toHaveLength(0);
  });

  test("parses content correctly", () => {
    const result = parseDiff(SAMPLE_DIFF);
    const lines = result[0]?.hunks[0]?.lines ?? [];
    const addedImport = lines.find(
      (l) => l.type === "add" && l.content.includes("newModule"),
    );
    expect(addedImport?.content).toBe('import { newModule } from "./new";');
  });
});
