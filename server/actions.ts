export type ActionItem = {
  label: string;
  command: string;
  /** "shell" executes as subshell on server (default), "terminal" sends to cmux terminal with Enter, "text" pastes to terminal without Enter */
  type?: "shell" | "terminal" | "text";
  input?: {
    placeholder: string;
    variable: string;
  };
};

export type SubmenuItem = {
  label: string;
  submenu: ActionItem[];
};

export type MenuItem = ActionItem | SubmenuItem;

export function isSubmenu(item: MenuItem): item is SubmenuItem {
  return "submenu" in item;
}

export function isActionWithInput(item: MenuItem): item is ActionItem & { input: { placeholder: string; variable: string } } {
  return !isSubmenu(item) && item.input !== undefined;
}

export const DEFAULT_ACTIONS: MenuItem[] = [
  {
    label: "Commit",
    type: "shell",
    command: 'git commit -m "$MSG"',
    input: { placeholder: "Commit message...", variable: "MSG" },
  },
  {
    label: "Create PR",
    type: "shell",
    command: 'gh pr create --title "$TITLE"',
    input: { placeholder: "PR title...", variable: "TITLE" },
  },
  {
    label: "AI Review",
    type: "terminal",
    command: 'claude "このPRの変更をレビューしてください" --allowedTools bash',
  },
];

export function shellEscape(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

export function buildCommandWithEnv(
  command: string,
  variables: Record<string, string>,
): string {
  const envParts = Object.entries(variables)
    .map(([key, value]) => `${key}=${shellEscape(value)}`)
    .join(" ");
  if (!envParts) return command;
  return `${envParts} ${command}`;
}

/**
 * Find an action by its index path.
 * "0" → top-level item 0
 * "2.1" → submenu of item 2, sub-item 1
 */
export function findAction(actions: MenuItem[], id: string): ActionItem | null {
  if (!id) return null;
  const parts = id.split(".").map(Number);
  if (parts.some(n => isNaN(n))) return null;

  const topIndex = parts[0];
  if (topIndex === undefined || topIndex < 0 || topIndex >= actions.length) return null;

  const item = actions[topIndex];
  if (parts.length === 1) {
    return isSubmenu(item) ? null : item;
  }

  if (parts.length === 2 && isSubmenu(item)) {
    const subIndex = parts[1];
    if (subIndex === undefined || subIndex < 0 || subIndex >= item.submenu.length) return null;
    return item.submenu[subIndex];
  }

  return null;
}

export async function loadActions(source: string): Promise<MenuItem[]> {
  let json: string;
  if (source === "-") {
    json = await new Response(Bun.stdin.stream()).text();
  } else {
    const file = Bun.file(source);
    if (!(await file.exists())) {
      throw new Error(`Actions file not found: ${source}`);
    }
    json = await file.text();
  }
  return JSON.parse(json) as MenuItem[];
}
