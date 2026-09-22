"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, destroySession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { ensureDemoWorkspace } from "@/lib/seed/demo";
import { authenticate, signUp } from "@/lib/services/accounts";
import { ServiceError } from "@/lib/services/workspace";

export interface AuthState {
  error: string | null;
}

// Basic brute-force brake: 8 failures per email+IP per 15 minutes. In-memory, so per instance
// (documented limitation; put AWS WAF rate limiting in front for multi-instance deployments).
const attempts = new Map<string, { n: number; reset: number }>();
function throttled(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.reset < now) return false;
  return a.n >= 8;
}
function recordFailure(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  attempts.set(key, !a || a.reset < now ? { n: 1, reset: now + 15 * 60_000 } : { n: a.n + 1, reset: a.reset });
}

async function clientKey(email: string) {
  const h = await headers();
  return `${email.toLowerCase()}|${h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"}`;
}

function safeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === "string" ? next : "";
  return /^\/[a-z0-9/_-]*$/i.test(n) && !n.startsWith("//") ? n : "/overview";
}

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const key = await clientKey(email);
  if (throttled(key)) return { error: "Too many attempts. Wait a few minutes and try again." };

  const user = await authenticate(await getDb(), email, password);
  if (!user) {
    recordFailure(key);
    return { error: "That email and password don't match." };
  }
  attempts.delete(key);
  await createSession(user.userId, user.orgId);
  redirect(safeNext(formData.get("next")));
}

export async function signUpAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  try {
    const user = await signUp(await getDb(), {
      name: String(formData.get("name") ?? ""),
      orgName: String(formData.get("orgName") ?? ""),
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
    });
    await createSession(user.userId, user.orgId);
  } catch (e) {
    if (e instanceof ServiceError) return { error: e.message };
    console.error("[signup failed]", e);
    return { error: "We couldn't create your account. Please try again." };
  }
  redirect("/overview");
}

/** Only available when DEMO_MODE=true: opens the clearly-labelled fictional workspace. */
export async function demoLoginAction() {
  if (process.env.DEMO_MODE !== "true") redirect("/login");
  const db = await getDb();
  const { userId, orgId } = await ensureDemoWorkspace(db);
  await createSession(userId, orgId);
  redirect("/overview");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
