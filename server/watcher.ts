import { watch } from "fs";

export type WatcherCallback = (event: string, filename: string | null) => void;
export type WatcherFactory = (dir: string, callback: WatcherCallback) => { close: () => void };

export const defaultWatcherFactory: WatcherFactory = (dir, callback) => {
  const watcher = watch(dir, { recursive: true }, (event, filename) => {
    // Ignore .git directory changes
    if (filename && (filename.startsWith(".git/") || filename.startsWith(".git\\"))) return;
    // Ignore node_modules
    if (filename && (filename.startsWith("node_modules/") || filename.startsWith("node_modules\\"))) return;
    callback(event, filename);
  });
  return { close: () => watcher.close() };
};

export type FileWatcher = ReturnType<typeof createFileWatcher>;

export function createFileWatcher(factory: WatcherFactory, cwd: string) {
  let watcher: { close: () => void } | null = null;
  const listeners = new Set<() => void>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    start() {
      if (watcher) return;
      watcher = factory(cwd, (_event, _filename) => {
        // Debounce notifications
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          for (const listener of listeners) {
            listener();
          }
        }, 300);
      });
    },

    stop() {
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    },

    onChanged(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
