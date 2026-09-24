import { BAND_LABEL, LEVEL_LABEL, priorityBand } from "@/lib/domain/prioritization";
import { cn } from "@/lib/utils";

/** The score, with its band spelled out so colour is never the only signal. */
export function PriorityChip({ score, size = "md", showLabel = true }: { score: number; size?: "sm" | "md"; showLabel?: boolean }) {
  const band = priorityBand(score);
  return (
    <span className="inline-flex items-center gap-2" title={`Priority score ${score.toFixed(0)} of 100`}>
      <span
        className={cn(
          "tabular grid place-items-center rounded-lg font-semibold",
          size === "sm" ? "size-8 text-[14.56px]" : "size-10 text-sm",
          band === "now" && "bg-ink text-white",
          band === "soon" && "bg-cue-soft text-cue-700",
          band === "consider" && "bg-sunken text-soft",
        )}
      >
        {Math.round(score)}
      </span>
      {showLabel ? <span className="text-xs font-medium text-soft">{BAND_LABEL[band]}</span> : null}
    </span>
  );
}

export function LevelDots({ value, label, tone = "ink" }: { value: number; label: string; tone?: "ink" | "cue" }) {
  return (
    <span role="img" aria-label={`${label}: ${LEVEL_LABEL[value] ?? value} (${value} of 5)`} className="inline-flex items-center gap-[3px]">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cn("size-1.5 rounded-full", i <= value ? (tone === "cue" ? "bg-cue" : "bg-ink") : "bg-line-strong")} />
      ))}
    </span>
  );
}
