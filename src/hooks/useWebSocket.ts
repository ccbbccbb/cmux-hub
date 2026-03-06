import { useEffect, useRef, useCallback, useState } from "react";

export type WSMessage =
  | { type: "diff-updated" }
  | { type: "pr-updated"; data: { pr: unknown; checks: unknown[]; comments: unknown[] } }
  | { type: string; data?: unknown };

const MAX_RECONNECT_DELAY = 30000;

export function useWebSocket(onMessage: (msg: WSMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const closedIntentionallyRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      setConnected(true);
      reconnectAttemptRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WSMessage;
        onMessageRef.current(msg);
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (closedIntentionallyRef.current) return;
      // Exponential backoff: 2s, 4s, 8s, ... up to MAX_RECONNECT_DELAY
      const delay = Math.min(2000 * 2 ** reconnectAttemptRef.current, MAX_RECONNECT_DELAY);
      reconnectAttemptRef.current++;
      setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    closedIntentionallyRef.current = false;
    connect();
    return () => {
      closedIntentionallyRef.current = true;
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected };
}
