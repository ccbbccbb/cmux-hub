import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api.ts";
import { parseDiff, type ParsedDiff } from "../lib/diff-parser.ts";

export function useDiff() {
  const [diff, setDiff] = useState<ParsedDiff>([]);
  const [rawDiff, setRawDiff] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState<string | null>(null);

  const fetchDiff = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await api.getAutoDiff();
      setRawDiff(result.diff);
      // Use server-highlighted files if available, fall back to client-side parse
      setDiff(result.files ?? parseDiff(result.diff));
      setBase(result.base);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch diff");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDiff();
  }, [fetchDiff]);

  return {
    diff,
    rawDiff,
    loading,
    error,
    base,
    refresh: fetchDiff,
  };
}
