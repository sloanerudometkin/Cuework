import type { LucideIcon } from "lucide-react";
import * as React from "react";

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong bg-surface/60 px-6 py-12 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-sunken text-soft">
        <Icon className="size-5" aria-hidden />
      </span>
      <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
      {children ? <p className="mt-1.5 max-w-md text-sm text-muted">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
