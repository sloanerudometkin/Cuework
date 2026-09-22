"use client";

import { FlaskConical } from "lucide-react";
import * as React from "react";
import { useToast } from "@/components/ui/toast";
import { resetDemoAction } from "@/lib/actions/workspace";
import { useRouter } from "next/navigation";

export function DemoBanner() {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <div className="no-print border-b border-cue/30 bg-cue-soft px-4 py-2 text-[13px] text-cue-700 sm:px-6 lg:px-10">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-3 gap-y-1">
        <FlaskConical className="size-4 shrink-0" aria-hidden />
        <p className="flex-1 leading-snug">
          <strong className="font-semibold">Demo workspace.</strong> Every number here is fictional sample data, and no integration is live.
        </p>
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await resetDemoAction();
              if (r.ok) {
                toast.success("Demo workspace reset to its starting state.");
                router.push("/overview");
                router.refresh();
              } else toast.error(r.error);
            })
          }
          className="rounded-md px-2 py-0.5 font-semibold underline underline-offset-2 hover:bg-cue/10 disabled:opacity-50"
        >
          {pending ? "Resetting…" : "Reset demo"}
        </button>
      </div>
    </div>
  );
}
