import Link from "next/link";
import { Logo } from "@/components/domain/logo";

const LOOP = ["Data", "Recommendation", "Priority", "Weekly commitment", "Completed work", "Leadership report"];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-ink p-12 text-white lg:flex">
        <Link href="/" aria-label="Cuework home">
          <Logo variant="reverse" height={60} />
        </Link>
        <div>
          <h2 className="max-w-md text-[2rem] font-semibold leading-tight tracking-tight">
            Priorities your team can <span className="text-cue">actually finish.</span>
          </h2>
          <p className="mt-4 max-w-md text-[16.8px] leading-relaxed text-side-text">
            Cuework connects your data to expert recommendations, a weekly plan that respects real capacity, completed work, and a report leadership can trust.
          </p>
          <ol className="mt-10 space-y-3" aria-label="How Cuework works">
            {LOOP.map((step, i) => (
              <li key={step} className="flex items-center gap-3 text-sm text-side-text">
                <span className="tabular grid size-6 place-items-center rounded-full border border-white/20 text-xs">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
        <p className="text-xs text-side-muted">Sample workspaces use clearly labelled fictional data.</p>
      </aside>
      <div className="flex flex-col px-5 py-8 sm:px-10">
        <Link href="/" className="mb-10 lg:hidden" aria-label="Cuework home">
          <Logo height={44} />
        </Link>
        <main id="main" className="m-auto w-full max-w-[26rem]">
          {children}
        </main>
      </div>
    </div>
  );
}
