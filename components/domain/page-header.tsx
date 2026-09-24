import * as React from "react";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1.5 text-[12.32px] font-semibold uppercase tracking-[0.08em] text-muted">{eyebrow}</p> : null}
        <h1 className="text-[1.65rem] leading-tight sm:text-3xl">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-[16.8px] text-soft">{description}</p> : null}
      </div>
      {actions ? <div className="no-print flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
