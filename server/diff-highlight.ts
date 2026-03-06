import type { DiffFile } from "../src/lib/diff-parser.ts";
import { getLangFromPath, highlightLines } from "./highlighter.ts";

export async function highlightDiffFiles(files: DiffFile[]): Promise<DiffFile[]> {
  return Promise.all(files.map(async (file) => {
    const lang = getLangFromPath(file.newPath);
    if (!lang) return file;

    // Collect all lines per file and highlight as a continuous block per hunk
    const highlightedHunks = await Promise.all(
      file.hunks.map(async (hunk) => {
        // Use newLine content for add/context, oldLine content for delete
        const code = hunk.lines.map(l => l.content).join("\n");
        const tokenLines = await highlightLines(code, lang);

        return {
          ...hunk,
          lines: hunk.lines.map((line, i) => ({
            ...line,
            tokens: tokenLines[i],
          })),
        };
      })
    );

    return { ...file, hunks: highlightedHunks };
  }));
}
