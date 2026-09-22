import Link from "next/link";
import { Logo } from "@/components/domain/logo";
import { buttonStyles } from "@/components/ui/button";

export function PublicHeader({ tone = "light" }: { tone?: "light" | "dark" }) {
  const dark = tone === "dark";
  return (
    <header className={dark ? "bg-ink" : "border-b border-line bg-paper/90 backdrop-blur"}>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" aria-label="Cuework home"><Logo variant={dark ? "reverse" : "primary"} height={26} /></Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          <Link href="/pricing" className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${dark ? "text-side-text hover:text-white" : "text-soft hover:text-ink"}`}>Pricing</Link>
          <Link href="/login" className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${dark ? "text-side-text hover:text-white" : "text-soft hover:text-ink"}`}>Sign in</Link>
          <Link href="/signup" className={buttonStyles({ variant: dark ? "cue" : "primary", size: "sm" })}>Get started</Link>
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-line bg-paper">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <Logo height={20} className="opacity-80" />
        <p>Sample workspaces use clearly labelled fictional data. Billing in this build is simulated.</p>
        <p className="flex gap-4"><Link href="/pricing" className="hover:text-ink">Pricing</Link><Link href="/login" className="hover:text-ink">Sign in</Link></p>
      </div>
    </footer>
  );
}
