"use client";

import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { loginAction, signUpAction, type AuthState } from "@/lib/actions/auth";

const initial: AuthState = { error: null };

export function LoginForm({ next, expired }: { next?: string; expired?: boolean }) {
  const [state, action, pending] = React.useActionState(loginAction, initial);
  return (
    <form action={action} className="space-y-4" noValidate>
      {expired ? <p role="status" className="rounded-lg bg-sunken px-3 py-2 text-sm text-soft">Your session ended. Please sign in again.</p> : null}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Work email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" aria-invalid={Boolean(state.error)} aria-describedby={state.error ? "form-error" : undefined} />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={Boolean(state.error)} aria-describedby={state.error ? "form-error" : undefined} />
      </Field>
      {state.error ? (
        <p id="form-error" role="alert" className="text-sm font-medium text-brick">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-muted">
        New to Cuework?{" "}
        <Link href="/signup" className="font-medium text-ink underline underline-offset-4">
          Create a workspace
        </Link>
      </p>
    </form>
  );
}

export function SignUpForm() {
  const [state, action, pending] = React.useActionState(signUpAction, initial);
  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label="Your name" htmlFor="name">
        <Input id="name" name="name" autoComplete="name" required />
      </Field>
      <Field label="Organization" htmlFor="orgName" hint="Your team or company. You'll add brands and websites next.">
        <Input id="orgName" name="orgName" autoComplete="organization" required />
      </Field>
      <Field label="Work email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password" hint="At least 10 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-brick">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Creating workspace…" : "Create workspace"}
      </Button>
      <p className="text-center text-xs text-muted">Starts on the Starter plan. Billing is simulated in this build — no payment is collected.</p>
      <p className="text-center text-sm text-muted">
        Already have a workspace?{" "}
        <Link href="/login" className="font-medium text-ink underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}
