import React, { useCallback } from "react";
import { api } from "../lib/api.ts";

type Comment = {
  id: number;
  body: string;
  user: string;
  path: string;
  line: number;
  createdAt: string;
};

type Props = {
  comments: Comment[];
};

export function PRComments({ comments }: Props) {
  const handleSendToTerminal = useCallback(async (comment: Comment) => {
    try {
      const text = `${comment.path}:${comment.line}\n@${comment.user}: ${comment.body}`;
      await api.sendToTerminal(text);
    } catch (e) {
      console.error("Failed to send comment to terminal:", e);
    }
  }, []);

  if (comments.length === 0) return null;

  return (
    <div className="border border-gray-700 rounded-lg p-3 mb-4">
      <h3 className="text-sm font-semibold text-gray-400 mb-2">
        PR Comments ({comments.length})
      </h3>
      <div className="space-y-3">
        {comments.map((comment) => (
          <div
            key={comment.id}
            className="border border-gray-700 rounded p-2 text-sm hover:bg-gray-800/50 cursor-pointer"
            onClick={() => handleSendToTerminal(comment)}
            title="Click to send to terminal"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-blue-400 font-semibold">@{comment.user}</span>
              <span className="text-gray-600 text-xs">
                {comment.path}:{comment.line}
              </span>
            </div>
            <p className="text-gray-300 whitespace-pre-wrap">{comment.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
