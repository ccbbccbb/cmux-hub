import { watch as fsWatch, existsSync } from "node:fs";
import { findPlanFile } from "./plan.ts";

type BroadcastFn = (message: string) => void;

export function createPlanWatcher(cwd: string, broadcast: BroadcastFn) {
  let watcher: { close: () => void } | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveTimer: ReturnType<typeof setInterval> | null = null;

  const resolve = async () => {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    const planPath = await findPlanFile(cwd).catch(() => null);
    if (!planPath || !existsSync(planPath)) return;

    try {
      watcher = fsWatch(planPath, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          broadcast(JSON.stringify({ type: "plan-updated" }));
        }, 300);
      });
    } catch {
      // Plan file may not exist yet
    }
  };

  return {
    start() {
      resolve();
      // Re-resolve periodically (new session may create a new plan)
      resolveTimer = setInterval(resolve, 30_000);
    },
    stop() {
      watcher?.close();
      watcher = null;
      if (resolveTimer) {
        clearInterval(resolveTimer);
        resolveTimer = null;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    },
  };
}
