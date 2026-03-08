import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api.ts";
import type { ParsedDiff } from "../lib/diff-parser.ts";

export function usePlanData() {
  const [files, setFiles] = useState<ParsedDiff>([]);
  const [planPath, setPlanPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlan = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .getPlan()
      .then((res) => {
        if (res.found && res.files) {
          setFiles(res.files);
          setPlanPath(res.path ?? null);
        } else {
          setError("Plan file not found");
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load plan"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  // Listen for plan-updated WebSocket events
  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail as { type: string };
      if (msg.type === "plan-updated") {
        fetchPlan();
      }
    };
    window.addEventListener("ws-message", handler);
    return () => window.removeEventListener("ws-message", handler);
  }, [fetchPlan]);

  return { files, planPath, loading, error };
}
