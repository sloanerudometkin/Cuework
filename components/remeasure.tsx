"use client";

import { Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { remeasureOutcomesAction } from "@/lib/actions/workspace";
import { useAction } from "@/lib/use-action";

export function RemeasureButton() {
  const { run, pending } = useAction();
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() => run(() => remeasureOutcomesAction(), { success: (d) => (d.measured ? `Re-measured ${d.measured} outcome${d.measured === 1 ? "" : "s"} against the latest data.` : "No outcome has newer data to measure yet.") })}
    >
      <Scale className="size-3.5" aria-hidden />
      {pending ? "Measuring…" : "Re-measure outcomes"}
    </Button>
  );
}
