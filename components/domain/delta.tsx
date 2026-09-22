import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatPct, type Sentiment } from "@/lib/domain/metrics";
import { cn } from "@/lib/utils";

const TONE: Record<Sentiment, string> = { good: "text-moss", bad: "text-brick", neutral: "text-muted" };
const WORD: Record<Sentiment, string> = { good: "favourable", bad: "unfavourable", neutral: "little change" };

/**
 * A change with meaning: the colour reflects whether the move is *good* for that
 * metric (a fall in cost is green), and the text never relies on colour alone.
 */
export function Delta({ value, sentiment, label, className }: { value: number | null; sentiment: Sentiment; label?: string; className?: string }) {
  if (value == null) return <span className={cn("text-xs text-muted", className)}>{label ? `${label} —` : "—"}</span>;
  const Icon = Math.abs(value) < 0.005 ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("tabular inline-flex items-center gap-0.5 text-xs font-medium", TONE[sentiment], className)}>
      <Icon className="size-3.5" aria-hidden />
      {label ? <span className="mr-0.5 font-normal text-muted">{label}</span> : null}
      {formatPct(value)}
      <span className="sr-only"> ({WORD[sentiment]})</span>
    </span>
  );
}
