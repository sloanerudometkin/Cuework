import type { LoadStatus } from "@/lib/domain/capacity";
import { cn, hoursLabel } from "@/lib/utils";

const FILL: Record<LoadStatus, string> = { healthy: "bg-ink", tight: "bg-cue", over: "bg-brick" };
const LABEL: Record<LoadStatus, string> = { healthy: "Healthy", tight: "Tight", over: "Over capacity" };
const TEXT: Record<LoadStatus, string> = { healthy: "text-moss", tight: "text-cue-700", over: "text-brick" };

/**
 * The track always represents 120% of capacity, so bars are comparable across people.
 * The solid tick is 100% (the hard limit); the dashed tick is where the planning buffer starts.
 */
export function CapacityMeter({
  planned,
  plannable,
  status,
  buffer = 0.15,
  size = "md",
  label,
}: {
  planned: number;
  plannable: number;
  status: LoadStatus;
  buffer?: number;
  size?: "sm" | "md";
  label?: string;
}) {
  const util = plannable > 0 ? planned / plannable : planned > 0 ? 1.2 : 0;
  const pct = Math.min(util, 1.2) / 1.2;
  const remaining = plannable - planned;
  return (
    <div>
      <div
        role="meter"
        aria-label={label ?? "Capacity used"}
        aria-valuemin={0}
        aria-valuemax={Math.max(plannable, planned)}
        aria-valuenow={planned}
        aria-valuetext={`${hoursLabel(planned)} planned of ${hoursLabel(plannable)} available. ${LABEL[status]}.`}
        className={cn("relative w-full overflow-hidden rounded-full bg-sunken", size === "sm" ? "h-2" : "h-3")}
      >
        <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out", FILL[status])} style={{ width: `${pct * 100}%` }} />
        <span aria-hidden className="absolute inset-y-0 border-l border-dashed border-ink/35" style={{ left: `${((1 - buffer) / 1.2) * 100}%` }} />
        <span aria-hidden className="absolute inset-y-0 w-px bg-ink/70" style={{ left: `${(1 / 1.2) * 100}%` }} />
      </div>
      {size === "md" ? (
        <div className="mt-2 flex items-baseline justify-between gap-3 text-[14.56px]">
          <span className="tabular text-ink">
            <strong className="font-semibold">{hoursLabel(planned)}</strong> <span className="text-muted">of {hoursLabel(plannable)}</span>
          </span>
          <span className={cn("tabular font-medium", TEXT[status])}>
            {status === "over" ? `${hoursLabel(-remaining)} over` : `${hoursLabel(remaining)} left`} · {LABEL[status]}
          </span>
        </div>
      ) : null}
    </div>
  );
}
