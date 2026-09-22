import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badge = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap leading-5", {
  variants: {
    tone: {
      neutral: "bg-sunken text-soft",
      ink: "bg-ink text-white",
      cue: "bg-cue-soft text-cue-700",
      good: "bg-moss-soft text-moss",
      bad: "bg-brick-soft text-brick",
      info: "bg-slate-soft text-slate",
      outline: "border border-line-strong text-soft bg-surface",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...props} />;
}
