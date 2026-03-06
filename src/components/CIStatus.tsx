import React from "react";

type Check = {
  name: string;
  status: string;
  conclusion: string;
  url: string;
};

type Props = {
  checks: Check[];
};

function statusIcon(check: Check): string {
  if (check.conclusion === "SUCCESS") return "\u2705";
  if (check.conclusion === "FAILURE") return "\u274c";
  if (check.status === "IN_PROGRESS" || check.status === "QUEUED") return "\u23f3";
  return "\u2b55";
}

function statusColor(check: Check): string {
  if (check.conclusion === "SUCCESS") return "text-green-400";
  if (check.conclusion === "FAILURE") return "text-red-400";
  return "text-yellow-400";
}

export function CIStatus({ checks }: Props) {
  if (checks.length === 0) return null;

  return (
    <div className="border border-gray-700 rounded-lg p-3 mb-4">
      <h3 className="text-sm font-semibold text-gray-400 mb-2">CI Status</h3>
      <div className="space-y-1">
        {checks.map((check) => (
          <div key={check.name} className="flex items-center gap-2 text-sm">
            <span>{statusIcon(check)}</span>
            <a
              href={check.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`${statusColor(check)} hover:underline`}
            >
              {check.name}
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
