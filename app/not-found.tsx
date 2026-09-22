import Link from "next/link";
import { Logo } from "@/components/domain/logo";
import { buttonStyles } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <Logo height={40} className="mx-auto" />
        <h1 className="mt-8 text-3xl">We couldn&apos;t find that page</h1>
        <p className="mt-2 text-soft">The link may be out of date, or the page may have moved.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/overview" className={buttonStyles({})}>Command Center</Link>
          <Link href="/" className={buttonStyles({ variant: "secondary" })}>Home</Link>
        </div>
      </div>
    </main>
  );
}
