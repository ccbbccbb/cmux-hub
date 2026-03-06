import React, { useState, useRef, useEffect } from "react";
import { Button } from "./ui/button.tsx";
import { Textarea } from "./ui/textarea.tsx";

type Props = {
  onSubmit: (comment: string) => void;
  onCancel: () => void;
};

export function CommentForm({ onSubmit, onCancel }: Props) {
  const [comment, setComment] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (comment.trim()) {
      onSubmit(comment.trim());
      setComment("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit(e);
    }
    if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <Textarea
        ref={textareaRef}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Comment to send to terminal... (Cmd+Enter to submit)"
        className="min-h-[60px] bg-gray-800 border-gray-700 text-gray-200"
        rows={3}
      />
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!comment.trim()}>
          Send to Terminal
        </Button>
      </div>
    </form>
  );
}
