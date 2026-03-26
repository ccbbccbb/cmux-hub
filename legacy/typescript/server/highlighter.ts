import { createHighlighter, type Highlighter, type BundledLanguage } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

const LANG_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  mts: "typescript",
  cts: "typescript",
  json: "json",
  md: "markdown",
  mdx: "mdx",
  css: "css",
  scss: "scss",
  html: "html",
  vue: "vue",
  svelte: "svelte",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sql: "sql",
  graphql: "graphql",
  dockerfile: "dockerfile",
  makefile: "makefile",
};

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark"],
      langs: [...new Set(Object.values(LANG_MAP))],
    });
  }
  return highlighterPromise;
}

export function getLangFromPath(filePath: string): string | null {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const basename = filePath.split("/").pop()?.toLowerCase() ?? "";

  if (basename === "dockerfile") return "dockerfile";
  if (basename === "makefile") return "makefile";

  return LANG_MAP[ext] ?? null;
}

type HighlightedToken = {
  content: string;
  color?: string;
};

export type HighlightedLine = HighlightedToken[];

export async function highlightLines(
  code: string,
  lang: string | null,
): Promise<HighlightedLine[]> {
  if (!lang) {
    return code.split("\n").map((line) => [{ content: line }]);
  }

  try {
    const highlighter = await getHighlighter();
    const result = highlighter.codeToTokens(code, {
      lang: lang as BundledLanguage,
      theme: "github-dark",
    });
    return result.tokens.map((line) =>
      line.map((token) => ({
        content: token.content,
        color: token.color,
      })),
    );
  } catch {
    return code.split("\n").map((line) => [{ content: line }]);
  }
}
