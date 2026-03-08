import { useState, useEffect, useCallback, useActionState, useTransition, startTransition } from "react";
import { api } from "../lib/api.ts";
import { parseDiff, type ParsedDiff } from "../lib/diff-parser.ts";

export type SelectedCommit = { hash: string; message: string; relativeDate: string };

type CommitViewState = {
  diff: ParsedDiff;
  rawDiff: string;
  commit: SelectedCommit | null;
  error: string | null;
};

const initialCommitView: CommitViewState = { diff: [], rawDiff: "", commit: null, error: null };

export function useDiff() {
  const [diff, setDiff] = useState<ParsedDiff>([]);
  const [rawDiff, setRawDiff] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState<string | null>(null);
  const [isPending, startRefreshTransition] = useTransition();

  const [commitView, dispatchCommitView, isCommitLoading] = useActionState(
    async (_prev: CommitViewState, action: SelectedCommit | null): Promise<CommitViewState> => {
      if (!action) return initialCommitView;
      try {
        const result = await api.getCommitDiff(action.hash);
        return {
          diff: result.files ?? parseDiff(result.diff),
          rawDiff: result.diff,
          commit: action,
          error: null,
        };
      } catch (e) {
        return {
          diff: [],
          rawDiff: "",
          commit: action,
          error: e instanceof Error ? e.message : "Failed to fetch commit diff",
        };
      }
    },
    initialCommitView,
  );

  const fetchDiff = useCallback(async () => {
    try {
      setError(null);
      startTransition(() => dispatchCommitView(null));
      const result = await api.getAutoDiff();
      startRefreshTransition(() => {
        setRawDiff(result.diff);
        setDiff(result.files ?? parseDiff(result.diff));
        setBase(result.base);
        setLoading(false);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch diff");
      setLoading(false);
    }
  }, [dispatchCommitView]);

  const selectCommit = useCallback(
    (commit: SelectedCommit) => {
      startTransition(() => dispatchCommitView(commit));
    },
    [dispatchCommitView],
  );

  const clearCommit = useCallback(() => {
    startTransition(() => dispatchCommitView(null));
    fetchDiff();
  }, [dispatchCommitView, fetchDiff]);

  useEffect(() => {
    fetchDiff();
  }, [fetchDiff]);

  // Listen for diff-updated WebSocket events
  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail as { type: string };
      if (msg.type === "diff-updated") {
        fetchDiff();
      }
    };
    window.addEventListener("ws-message", handler);
    return () => window.removeEventListener("ws-message", handler);
  }, [fetchDiff]);

  // When a commit is selected, use commitView state; otherwise auto-diff state
  const isCommitSelected = commitView.commit !== null;

  return {
    diff: isCommitSelected ? commitView.diff : diff,
    rawDiff: isCommitSelected ? commitView.rawDiff : rawDiff,
    loading: loading || isCommitLoading,
    refreshing: isPending,
    error: isCommitSelected ? commitView.error : error,
    base,
    selectedCommit: commitView.commit,
    hasUncommittedChanges: diff.length > 0,
    refresh: fetchDiff,
    selectCommit,
    clearCommit,
  };
}
