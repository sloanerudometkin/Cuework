import "server-only";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/lib/db/client";
import { membershipFor } from "@/lib/services/accounts";
import type { Actor } from "@/lib/services/workspace";

const COOKIE = "cw_session";
const MAX_AGE = 14 * 24 * 60 * 60;

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return new TextEncoder().encode(s);
  if (process.env.NODE_ENV === "production") {
    // Fail closed: an unsigned or guessable session cookie would be an account takeover.
    throw new Error("SESSION_SECRET must be set to 32+ random characters in production.");
  }
  return new TextEncoder().encode("dev-only-insecure-secret-run-npm-run-setup");
}

export async function createSession(userId: string, orgId: string) {
  const token = await new SignJWT({ oid: orgId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // HTTPS in production; set INSECURE_COOKIES=true only to test a production build over plain http locally.
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export const getSession = cache(async () => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.oid !== "string") return null;
    return { userId: payload.sub, orgId: payload.oid };
  } catch {
    return null;
  }
});

/**
 * Authoritative access check used by every page and server action: the signed
 * cookie must verify AND the membership must still exist in the database.
 */
export const requireWorkspace = cache(async () => {
  const session = await getSession();
  if (!session) redirect("/login");
  const db = await getDb();
  const user = await membershipFor(db, session.userId);
  if (!user || user.orgId !== session.orgId) redirect("/login?expired=1");
  const actor: Actor = { userId: user.userId, name: user.name };
  return { db, orgId: user.orgId, userId: user.userId, name: user.name, email: user.email, actor };
});

export type WorkspaceContext = Awaited<ReturnType<typeof requireWorkspace>>;
