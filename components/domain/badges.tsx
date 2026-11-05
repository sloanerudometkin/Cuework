import { CircleDashed, FlaskConical, Link2, ShieldCheck, Sparkles, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EVIDENCE_LABEL, VERDICT_LABEL, type EvidenceStrength, type Verdict } from "@/lib/domain/outcomes";
import { CATEGORY_LABEL, type Category } from "@/lib/domain/types";
import { Tip } from "@/components/ui/tooltip";

const CAT_TONE: Record<Category, "info" | "cue" | "good" | "neutral" | "outline"> = { seo: "info", aeo: "neutral", sem: "cue", analytics: "good", content: "outline" };

export function CategoryBadge({ category }: { category: Category }) {
  return <Badge tone={CAT_TONE[category]}>{CATEGORY_LABEL[category]}</Badge>;
}

const SOURCE = {
  demo: { label: "Demo data", tone: "info", Icon: FlaskConical, tip: "Fictional data generated for this sample workspace. Not a live integration." },
  imported: { label: "Imported data", tone: "good", Icon: Upload, tip: "Uploaded by your team from a CSV export." },
  connected: { label: "Connected data", tone: "ink", Icon: Link2, tip: "Synced automatically from a connected account." },
  error: { label: "Sync error", tone: "bad", Icon: CircleDashed, tip: "The last sync failed." },
} as const;

/** Every number in Cuework says where it came from. Demo data is never presented as live. */
/** Shows the local AI agent's verdict on a lead (the rules engine found it; the agent checked it). */
export function AgentBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return null;
  const kept = verdict === "keep";
  return (
    <Tip
      content={
        kept
          ? "Cuework's rules flagged this; a free AI agent running locally then checked the data and confirmed it. It can't change the numbers."
          : "A free AI agent running locally checked this lead and thinks it's a false alarm or a duplicate. Open it to see why."
      }
    >
      <span>
        <Badge tone={kept ? "info" : "outline"}>
          <Sparkles className="size-3" aria-hidden />
          {kept ? "AI-checked" : "Set aside by AI"}
        </Badge>
      </span>
    </Tip>
  );
}

export function SourceBadge({ status }: { status: keyof typeof SOURCE | null }) {
  if (!status) return <Badge tone="outline">No data yet</Badge>;
  const s = SOURCE[status];
  return (
    <Tip content={s.tip}>
      <span>
        <Badge tone={s.tone}>
          <s.Icon className="size-3" aria-hidden />
          {s.label}
        </Badge>
      </span>
    </Tip>
  );
}

const V_TONE = { improved: "good", declined: "bad", flat: "neutral", pending: "outline" } as const;

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <Badge tone={V_TONE[verdict]}>{VERDICT_LABEL[verdict]}</Badge>;
}

/** Correlation vs. proof, always visible next to a result. */
export function EvidenceBadge({ strength }: { strength: EvidenceStrength }) {
  const e = EVIDENCE_LABEL[strength];
  return (
    <Tip content={e.long}>
      <span>
        <Badge tone={strength === "experiment" ? "ink" : strength === "corroborated" ? "info" : "outline"}>
          <ShieldCheck className="size-3" aria-hidden />
          {e.short}
        </Badge>
      </span>
    </Tip>
  );
}
