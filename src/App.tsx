import React, { useState, useEffect, useCallback } from "react";
import { DiffView } from "./components/DiffView.tsx";
import { Toolbar } from "./components/Toolbar.tsx";
import { CIStatus } from "./components/CIStatus.tsx";
import { PRComments } from "./components/PRComments.tsx";
import { useDiff } from "./hooks/useDiff.ts";
import { useWebSocket } from "./hooks/useWebSocket.ts";
import { api } from "./lib/api.ts";
import "./index.css";

type Check = {
  name: string;
  status: string;
  conclusion: string;
  url: string;
};

type PRComment = {
  id: number;
  body: string;
  user: string;
  path: string;
  line: number;
  createdAt: string;
};

export default function App() {
  const { diff, loading, error, refresh } = useDiff();
  const [branch, setBranch] = useState("...");
  const [checks, setChecks] = useState<Check[]>([]);
  const [prComments, setPrComments] = useState<PRComment[]>([]);

  useEffect(() => {
    api.getStatus().then((s) => setBranch(s.branch)).catch(() => {});
  }, []);

  const handleWSMessage = useCallback(
    (msg: { type: string; data?: unknown }) => {
      if (msg.type === "diff-updated") {
        refresh();
      }
      if (msg.type === "pr-updated" && msg.data) {
        const data = msg.data as { checks?: Check[]; comments?: PRComment[] };
        if (data.checks) setChecks(data.checks);
        if (data.comments) setPrComments(data.comments);
      }
    },
    [refresh],
  );

  useWebSocket(handleWSMessage);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <Toolbar branch={branch} onRefresh={refresh} />
      <div className="flex-1 overflow-auto p-4">
        <div className="flex gap-4">
          <div className="flex-1 min-w-0">
            <DiffView diff={diff} loading={loading} error={error} onRefresh={refresh} />
          </div>
          <div className="w-72 flex-shrink-0 space-y-4">
            <CIStatus checks={checks} />
            <PRComments comments={prComments} />
          </div>
        </div>
      </div>
    </div>
  );
}
