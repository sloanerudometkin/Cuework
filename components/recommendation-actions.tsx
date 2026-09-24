"use client";

import { Ban, CalendarClock, Check, MessageSquareMore, PlusCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { decideAction } from "@/lib/actions/workspace";
import { useAction } from "@/lib/use-action";
import { addDays, weekStart } from "@/lib/domain/dates";

export interface ActionMember {
  id: string;
  name: string;
  roleKey: string;
  remaining: number;
}

type Mode = "accept" | "defer" | "dismiss" | "refine" | null;

export function RecommendationActions({
  id,
  title,
  status,
  estimatedHours,
  suggestedOwnerId,
  members,
  workItemId,
  today,
}: {
  id: string;
  title: string;
  status: string;
  estimatedHours: number;
  suggestedOwnerId: string | null;
  members: ActionMember[];
  workItemId: string | null;
  today: string;
}) {
  const [mode, setMode] = React.useState<Mode>(null);
  const [rationale, setRationale] = React.useState("");
  const [owner, setOwner] = React.useState(suggestedOwnerId ?? members[0]?.id ?? "");
  const [hours, setHours] = React.useState(String(estimatedHours));
  const [addToBacklog, setAddToBacklog] = React.useState(true);
  const [until, setUntil] = React.useState(addDays(weekStart(today), 28));
  const [error, setError] = React.useState<string | null>(null);
  const { run, pending } = useAction();
  const router = useRouter();

  const close = () => {
    setMode(null);
    setRationale("");
    setError(null);
  };
  // Once decided, the item usually leaves this list: drop the stale ?r= so the next item is shown.
  const done = () => {
    close();
    router.replace("/recommendations?tab=open");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "accept") {
      const h = Number(hours);
      if (!(h > 0 && h <= 80)) return setError("Estimated hours must be between 0 and 80.");
      run(() => decideAction(id, { decision: "accept", rationale, addToBacklog, ownerId: owner || null, hours: h }), {
        success: (d) => (d.workItemId ? "Accepted — added to the work backlog. Schedule it in the weekly plan." : "Accepted."),
        onOk: close,
        onError: setError,
      });
    } else if (mode === "defer") {
      run(() => decideAction(id, { decision: "defer", rationale, deferUntil: until }), { success: "Deferred. It will return to the inbox on that date.", onOk: done, onError: setError });
    } else if (mode === "dismiss") {
      run(() => decideAction(id, { decision: "dismiss", rationale }), { success: "Dismissed. Cuework will remember why and won't resurface it.", onOk: done, onError: setError });
    } else if (mode === "refine") {
      run(() => decideAction(id, { decision: "refine", rationale }), { success: "Marked for refinement.", onOk: done, onError: setError });
    }
  };

  if (status === "converted") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-soft">This recommendation is now work.</p>
        {workItemId ? (
          <Link href={`/work?w=${workItemId}`} className="text-sm font-medium text-ink underline underline-offset-4">
            Open work item →
          </Link>
        ) : null}
      </div>
    );
  }

  const owner1 = members.find((m) => m.id === owner);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setMode("accept")}>
          <Check className="size-4" aria-hidden /> Accept
        </Button>
        {status === "accepted" ? (
          <Button
            variant="cue"
            disabled={pending}
            onClick={() => run(() => decideAction(id, { decision: "convert", ownerId: suggestedOwnerId }), { success: "Converted to work. Schedule it in the weekly plan." })}
          >
            <PlusCircle className="size-4" aria-hidden /> Convert to work
          </Button>
        ) : null}
        <Button variant="secondary" onClick={() => setMode("defer")}>
          <CalendarClock className="size-4" aria-hidden /> Defer
        </Button>
        <Button variant="secondary" onClick={() => setMode("refine")}>
          <MessageSquareMore className="size-4" aria-hidden /> Refine
        </Button>
        <Button variant="danger" onClick={() => setMode("dismiss")}>
          <Ban className="size-4" aria-hidden /> Dismiss
        </Button>
      </div>

      <Dialog open={mode !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent
          title={mode === "accept" ? "Accept and plan" : mode === "defer" ? "Defer this recommendation" : mode === "dismiss" ? "Dismiss this recommendation" : "Request refinement"}
          description={title}
        >
          <form onSubmit={submit} className="space-y-4">
            {mode === "accept" ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Owner" htmlFor="owner">
                    <Select id="owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Estimated hours" htmlFor="hours">
                    <Input id="hours" type="number" inputMode="decimal" step="0.5" min="0.5" max="80" value={hours} onChange={(e) => setHours(e.target.value)} />
                  </Field>
                </div>
                {owner1 ? (
                  <p className="rounded-lg bg-sunken px-3 py-2 text-[14.56px] text-soft">
                    {owner1.name} has <strong className="text-ink">{Math.round(owner1.remaining * 10) / 10}h</strong> unplanned this week.{" "}
                    {Number(hours) > owner1.remaining ? "This won't fit this week — you can still accept it and schedule it later." : "It fits this week."}
                  </p>
                ) : null}
                <label className="flex items-start gap-2.5 text-sm">
                  <input type="checkbox" checked={addToBacklog} onChange={(e) => setAddToBacklog(e.target.checked)} className="mt-1 size-4 accent-[var(--color-ink)]" />
                  <span>
                    Add to the work backlog now
                    <span className="block text-xs text-muted">Creates a work item linked to this recommendation and its evidence.</span>
                  </span>
                </label>
                <Field label="Why accept? (optional)" htmlFor="why" hint="Recorded in the decision log so the team remembers the reasoning.">
                  <Textarea id="why" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="e.g. Biggest gap on our most strategic property." />
                </Field>
              </>
            ) : null}
            {mode === "defer" ? (
              <>
                <Field label="Revisit on" htmlFor="until">
                  <Input id="until" type="date" min={today} value={until} onChange={(e) => setUntil(e.target.value)} required />
                </Field>
                <Field label="Why defer?" htmlFor="why" error={error}>
                  <Textarea id="why" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="e.g. Web team is under a CMS freeze until October." required />
                </Field>
              </>
            ) : null}
            {mode === "dismiss" ? (
              <Field label="Why dismiss?" htmlFor="why" hint="Required — this becomes institutional memory, so the same idea isn't relitigated." error={error}>
                <Textarea id="why" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="e.g. Expected behaviour: flight-status searches are served by the result's own widget." required />
              </Field>
            ) : null}
            {mode === "refine" ? (
              <Field label="What should be refined?" htmlFor="why" error={error}>
                <Textarea id="why" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="e.g. Split by device and by checkout step before we commit hours." required />
              </Field>
            ) : null}
            {mode === "accept" && error ? <p role="alert" className="text-sm font-medium text-brick">{error}</p> : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" variant={mode === "dismiss" ? "danger" : "primary"} disabled={pending}>
                {pending ? "Saving…" : mode === "accept" ? "Accept" : mode === "defer" ? "Defer" : mode === "dismiss" ? "Dismiss" : "Send for refinement"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
