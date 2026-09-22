"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Button, buttonStyles } from "@/components/ui/button";

export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-2xl border border-line bg-surface p-8 text-center shadow-card" role="alert">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-brick-soft text-brick">
        <TriangleAlert className="size-6" aria-hidden />
      </span>
      <h1 className="mt-4 text-xl">This page couldn&apos;t load</h1>
      <p className="mt-2 text-soft">Something went wrong on our side. Your data is safe. Try again, or head back to the Command Center.</p>
      {error.digest ? <p className="mt-3 font-mono text-xs text-muted">Reference: {error.digest}</p> : null}
      <div className="mt-6 flex justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link href="/overview" className={buttonStyles({ variant: "secondary" })}>
          Command Center
        </Link>
      </div>
    </div>
  );
}
