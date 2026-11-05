"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refreshRecommendationsAction } from "@/lib/actions/workspace";
import { useAction } from "@/lib/use-action";

export function RefreshAnalysis() {
  const { run, pending } = useAction();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() =>
        run(() => refreshRecommendationsAction(), {
          success: (d) => (d.created + d.updated + d.resurfaced === 0 ? "Analysis is up to date." : `Analysis refreshed: ${d.created} new, ${d.updated} updated, ${d.resurfaced} resurfaced.`),
        })
      }
    >
      <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} aria-hidden />
      {pending ? "Analysing…" : "Re-run analysis"}
    </Button>
  );
}
