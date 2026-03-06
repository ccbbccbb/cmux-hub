import React, { useState } from "react";
import type { DiffLine as DiffLineType } from "../lib/diff-parser.ts";
import { CommentForm } from "./CommentForm.tsx";

type Props = {
  line: DiffLineType;
  filePath: string;
  onComment: (file: string, line: number, comment: string) => void;
};

const LINE_COLORS: Record<DiffLineType["type"], string> = {
  add: "bg-green-950/40 text-green-300",
  delete: "bg-red-950/40 text-red-300",
  context: "text-gray-300",
  header: "text-blue-400 bg-blue-950/30",
};

const GUTTER_COLORS: Record<DiffLineType["type"], string> = {
  add: "bg-green-950/60 text-green-500",
  delete: "bg-red-950/60 text-red-500",
  context: "bg-gray-900 text-gray-600",
  header: "bg-blue-950/40 text-blue-500",
};

export function DiffLine({ line, filePath, onComment }: Props) {
  const [showComment, setShowComment] = useState(false);
  const lineNumber = line.newLineNumber ?? line.oldLineNumber;

  const prefix = line.type === "add" ? "+" : line.type === "delete" ? "-" : " ";

  return (
    <>
      <tr className={`${LINE_COLORS[line.type]} group font-mono text-sm leading-6`}>
        <td className={`${GUTTER_COLORS[line.type]} w-8 text-right px-1 select-none align-top text-xs`}>
          {line.oldLineNumber ?? ""}
        </td>
        <td className={`${GUTTER_COLORS[line.type]} w-8 text-right px-1 select-none align-top text-xs`}>
          {line.newLineNumber ?? ""}
        </td>
        <td className="w-6 text-center select-none align-top">
          <button
            className="opacity-0 group-hover:opacity-100 text-blue-400 hover:text-blue-300 transition-opacity"
            onClick={() => setShowComment(!showComment)}
            title="Add comment"
          >
            +
          </button>
        </td>
        <td className="px-2 whitespace-pre-wrap break-all">
          <span className="select-none mr-1">{prefix}</span>
          {line.content}
        </td>
      </tr>
      {showComment && lineNumber !== null && (
        <tr>
          <td colSpan={4} className="p-2 bg-gray-900">
            <CommentForm
              onSubmit={(comment) => {
                onComment(filePath, lineNumber, comment);
                setShowComment(false);
              }}
              onCancel={() => setShowComment(false)}
            />
          </td>
        </tr>
      )}
    </>
  );
}
