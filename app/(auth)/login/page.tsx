import { FlaskConical } from "lucide-react";
import type { Metadata } from "next";
import { LoginForm } from "@/components/auth-form";
import { Button } from "@/components/ui/button";
import { demoLoginAction } from "@/lib/actions/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; expired?: string }> }) {
  const sp = await searchParams;
  const demo = process.env.DEMO_MODE === "true";
  return (
    <div className="animate-rise">
      <h1 className="text-[1.75rem]">Welcome back</h1>
      <p className="mb-7 mt-2 text-soft">Sign in to your workspace.</p>
      {demo ? (
        <>
          <form action={demoLoginAction}>
            <Button type="submit" variant="cue" size="lg" className="w-full">
              <FlaskConical className="size-4" aria-hidden />
              Explore the demo workspace
            </Button>
          </form>
          <p className="mt-2 text-center text-xs text-muted">Three fictional Harborline properties. All data is sample data; no integration is live.</p>
          <div className="my-6 flex items-center gap-3 text-xs text-muted" aria-hidden>
            <span className="h-px flex-1 bg-line" /> or sign in <span className="h-px flex-1 bg-line" />
          </div>
        </>
      ) : null}
      <LoginForm next={sp.next} expired={sp.expired === "1"} />
    </div>
  );
}
