"use client";

import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import {
  addMemberAction,
  addPropertyAction,
  archivePropertyAction,
  changePlanAction,
  removeMemberAction,
  updateMemberAction,
  updateOrgAction,
  updatePropertyAction,
} from "@/lib/actions/workspace";
import { PLAN_KEYS, PLANS, type PlanKey } from "@/lib/domain/entitlements";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";

export function OrgForm({ name, bufferPct }: { name: string; bufferPct: number }) {
  const { run, pending } = useAction();
  const [n, setN] = React.useState(name);
  const [b, setB] = React.useState(String(bufferPct));
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form
      className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        run(() => updateOrgAction({ name: n, planningBufferPct: Number(b) }), { success: "Organization settings saved.", onError: setError });
      }}
    >
      <Field label="Organization name" htmlFor="org-name" error={error}>
        <Input id="org-name" value={n} onChange={(e) => setN(e.target.value)} required maxLength={80} />
      </Field>
      <Field label="Planning buffer (%)" htmlFor="buffer" hint="Capacity kept free when planning.">
        <Input id="buffer" type="number" min={0} max={40} step={1} value={b} onChange={(e) => setB(e.target.value)} />
      </Field>
      <Button type="submit" disabled={pending || (n === name && Number(b) === bufferPct)}>{pending ? "Saving…" : "Save"}</Button>
    </form>
  );
}

// --- Team -----------------------------------------------------------------------

export interface MemberData {
  id?: string;
  name: string;
  title: string;
  roleKey: string;
  defaultWeeklyHours: number;
  defaultReservedHours: number;
}

export function MemberDialog({ member, trigger, canAdd = true }: { member?: MemberData; trigger: "add" | "edit"; canAdd?: boolean }) {
  const { run, pending } = useAction();
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState<MemberData>(member ?? { name: "", title: "", roleKey: "coordinator", defaultWeeklyHours: 40, defaultReservedHours: 8 });
  const [error, setError] = React.useState<string | null>(null);
  const set = (p: Partial<MemberData>) => setV((c) => ({ ...c, ...p }));
  return (
    <>
      {trigger === "add" ? (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)} disabled={!canAdd}><Plus className="size-3.5" aria-hidden /> Add team member</Button>
      ) : (
        <Button variant="ghost" size="icon" aria-label={`Edit ${member?.name}`} onClick={() => setOpen(true)}><Pencil className="size-4" aria-hidden /></Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={trigger === "add" ? "Add a team member" : `Edit ${member?.name}`} description="Weekly hours and reserved time set the default capacity for every week. You can override it for a specific week in the plan.">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              const input = { name: v.name, title: v.title, roleKey: v.roleKey as "manager" | "coordinator", defaultWeeklyHours: v.defaultWeeklyHours, defaultReservedHours: v.defaultReservedHours };
              run(() => (member?.id ? updateMemberAction(member.id, input) : addMemberAction(input)), { success: trigger === "add" ? "Team member added." : "Team member updated.", onOk: () => setOpen(false), onError: setError });
            }}
          >
            <Field label="Name" htmlFor="m-name"><Input id="m-name" value={v.name} onChange={(e) => set({ name: e.target.value })} required /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Title" htmlFor="m-title"><Input id="m-title" value={v.title} onChange={(e) => set({ title: e.target.value })} /></Field>
              <Field label="Role" htmlFor="m-role" hint="Used to suggest owners.">
                <Select id="m-role" value={v.roleKey} onChange={(e) => set({ roleKey: e.target.value })}><option value="manager">Manager</option><option value="coordinator">Coordinator</option></Select>
              </Field>
              <Field label="Weekly hours" htmlFor="m-hours"><Input id="m-hours" type="number" min={1} max={80} step={0.5} value={v.defaultWeeklyHours} onChange={(e) => set({ defaultWeeklyHours: Number(e.target.value) })} /></Field>
              <Field label="Reserved hours" htmlFor="m-res" hint="Meetings, BAU."><Input id="m-res" type="number" min={0} max={80} step={0.5} value={v.defaultReservedHours} onChange={(e) => set({ defaultReservedHours: Number(e.target.value) })} /></Field>
            </div>
            {error ? <p role="alert" className="text-sm font-medium text-brick">{error}</p> : null}
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RemoveMemberButton({ id, name }: { id: string; name: string }) {
  const { run, pending } = useAction();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Remove ${name}`}
      disabled={pending}
      onClick={() => {
        if (window.confirm(`Remove ${name}? Their unfinished work becomes unassigned.`)) run(() => removeMemberAction(id), { success: `${name} removed.` });
      }}
    >
      <Trash2 className="size-4" aria-hidden />
    </Button>
  );
}

// --- Properties -----------------------------------------------------------------

export interface PropertyData {
  id?: string;
  name: string;
  kind: string;
  domain: string;
  goal: string;
  conversionLabel: string;
  strategicWeight: number;
}

export function PropertyDialog({ property, trigger, canAdd = true }: { property?: PropertyData; trigger: "add" | "edit"; canAdd?: boolean }) {
  const { run, pending } = useAction();
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState<PropertyData>(property ?? { name: "", kind: "other", domain: "", goal: "", conversionLabel: "Conversions", strategicWeight: 3 });
  const [error, setError] = React.useState<string | null>(null);
  const set = (p: Partial<PropertyData>) => setV((c) => ({ ...c, ...p }));
  return (
    <>
      {trigger === "add" ? (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}><Plus className="size-3.5" aria-hidden /> Add property</Button>
      ) : (
        <Button variant="ghost" size="icon" aria-label={`Edit ${property?.name}`} onClick={() => setOpen(true)}><Pencil className="size-4" aria-hidden /></Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={trigger === "add" ? "Add a property" : `Edit ${property?.name}`} description="A property is one brand or website. Its goal and strategic weight shape how recommendations are prioritised.">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              const input = { name: v.name, kind: v.kind as "other", domain: v.domain, goal: v.goal, conversionLabel: v.conversionLabel, strategicWeight: v.strategicWeight };
              run(() => (property?.id ? updatePropertyAction(property.id, input) : addPropertyAction(input)), { success: trigger === "add" ? "Property added. Import data to get recommendations." : "Property updated.", onOk: () => setOpen(false), onError: setError });
            }}
          >
            <Field label="Name" htmlFor="p-name"><Input id="p-name" value={v.name} onChange={(e) => set({ name: e.target.value })} required /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type" htmlFor="p-kind"><Select id="p-kind" value={v.kind} onChange={(e) => set({ kind: e.target.value })}>{["authority", "ferry", "airport", "retail", "media", "other"].map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}</Select></Field>
              <Field label="Domain" htmlFor="p-domain"><Input id="p-domain" value={v.domain} onChange={(e) => set({ domain: e.target.value })} placeholder="example.com" /></Field>
            </div>
            <Field label="Goal" htmlFor="p-goal" hint="What is this property trying to achieve?"><Input id="p-goal" value={v.goal} onChange={(e) => set({ goal: e.target.value })} maxLength={240} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Key conversion" htmlFor="p-conv"><Input id="p-conv" value={v.conversionLabel} onChange={(e) => set({ conversionLabel: e.target.value })} /></Field>
              <Field label="Strategic weight" htmlFor="p-weight" hint="1 = low, 5 = central"><Select id="p-weight" value={v.strategicWeight} onChange={(e) => set({ strategicWeight: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
            </div>
            {error ? <p role="alert" className="text-sm font-medium text-brick">{error}</p> : null}
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending || (trigger === "add" && !canAdd)}>{pending ? "Saving…" : "Save"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ArchivePropertyButton({ id, name }: { id: string; name: string }) {
  const { run, pending } = useAction();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Archive ${name}`}
      disabled={pending}
      onClick={() => {
        if (window.confirm(`Archive ${name}? It disappears from the workspace and frees a plan slot. Its history is kept.`)) run(() => archivePropertyAction(id), { success: `${name} archived.` });
      }}
    >
      <Trash2 className="size-4" aria-hidden />
    </Button>
  );
}

// --- Plan -----------------------------------------------------------------------

export function PlanSwitcher({ current, interval: initial }: { current: PlanKey; interval: "month" | "year" }) {
  const { run, pending } = useAction();
  const [interval, setInterval] = React.useState<"month" | "year">(initial);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg bg-sunken p-1" role="group" aria-label="Billing interval">
        {(["month", "year"] as const).map((i) => (
          <button key={i} type="button" aria-pressed={interval === i} onClick={() => setInterval(i)} className={cn("rounded-md px-3 py-1.5 text-[13px] font-medium", interval === i ? "bg-surface text-ink shadow-card" : "text-soft hover:text-ink")}>
            {i === "month" ? "Monthly" : "Annual (save ~17%)"}
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {PLAN_KEYS.map((k) => {
          const p = PLANS[k];
          const active = k === current;
          const price = interval === "year" ? p.annualMonthlyPrice : p.monthlyPrice;
          return (
            <div key={k} className={cn("flex flex-col rounded-xl border p-4", active ? "border-ink bg-sunken/50" : "border-line bg-surface")}>
              <div className="flex items-center justify-between"><p className="font-semibold">{p.name}</p>{active ? <Badge tone="ink"><Check className="size-3" aria-hidden />Current</Badge> : p.highlighted ? <Badge tone="cue">Popular</Badge> : null}</div>
              <p className="tabular mt-2 text-2xl font-semibold">${price}<span className="text-sm font-normal text-muted">/mo</span></p>
              <p className="mt-1 flex-1 text-xs text-muted">{p.audience}</p>
              <Button
                className="mt-4"
                variant={active ? "secondary" : "primary"}
                size="sm"
                disabled={pending || (active && interval === initial)}
                onClick={() => {
                  setError(null);
                  run(() => changePlanAction(k, interval), { success: `Switched to ${p.name} (simulated — no payment taken).`, onError: setError });
                }}
              >
                {active ? (interval === initial ? "Current plan" : "Change billing interval") : PLAN_KEYS.indexOf(k) > PLAN_KEYS.indexOf(current) ? `Upgrade to ${p.name}` : `Switch to ${p.name}`}
              </Button>
            </div>
          );
        })}
      </div>
      {error ? <p role="alert" className="mt-3 rounded-lg border border-brick/30 bg-brick-soft px-4 py-3 text-sm font-medium text-brick">{error}</p> : null}
    </div>
  );
}
