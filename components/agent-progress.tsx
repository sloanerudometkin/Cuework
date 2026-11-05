"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

interface Status {
  running: boolean;
  total: number;
  done: number;
  failed: number;
}

/** Shows the AI agent's progress investigating leads, and refreshes the inbox as verdicts land. */
export function AgentProgress({ status }: { status: Status | null }) {
  const router = useRouter();
  const running = Boolean(status?.running);

  React.useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => router.refresh(), 10_000);
    return () => window.clearInterval(id);
  }, [running, router]);

  if (!status?.running) return null;
  const finished = status.done + status.failed;
  return (
    <div role="status" className="mb-6 flex items-center gap-2.5 rounded-xl border border-line bg-sunken px-4 py-3 text-sm text-soft">
      <Sparkles className="size-4 shrink-0 animate-pulse text-ink" aria-hidden />
      <span>
        The AI agent is investigating these leads against your data: {finished} of {status.total} done. Cards update as it decides.
      </span>
    </div>
  );
}
