import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Db } from "@/lib/db/connect";
import { memberships, organizations, subscriptions, teamMembers, users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { ServiceError } from "./workspace";

const signUpSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80),
  orgName: z.string().trim().min(2, "Enter your organization's name.").max(80),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
});

export interface AuthedUser {
  userId: string;
  orgId: string;
  name: string;
  email: string;
}

function slugify(s: string) {
  return `${s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "workspace"}-${randomBytes(3).toString("hex")}`;
}

/** Creates a user, an organisation on the Starter plan, and the user as its first team member. */
export async function signUp(db: Db, raw: z.input<typeof signUpSchema>): Promise<AuthedUser> {
  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) throw new ServiceError(parsed.error.issues[0].message);
  const { name, orgName, email, password } = parsed.data;

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) throw new ServiceError("An account with that email already exists. Try signing in.", "conflict");

  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ email, name, passwordHash }).returning();
    const [org] = await tx.insert(organizations).values({ name: orgName, slug: slugify(orgName) }).returning();
    await tx.insert(memberships).values({ userId: user.id, orgId: org.id, role: "owner" });
    await tx.insert(subscriptions).values({ orgId: org.id, plan: "starter" });
    await tx.insert(teamMembers).values({ orgId: org.id, userId: user.id, name, title: "Owner", roleKey: "manager" });
    return { userId: user.id, orgId: org.id, name, email };
  });
}

// Fixed hash so unknown-email logins take as long as real ones (no user enumeration by timing).
let dummyHash: Promise<string> | null = null;

export async function authenticate(db: Db, emailRaw: string, password: string): Promise<AuthedUser | null> {
  const email = emailRaw.trim().toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) {
    dummyHash ??= hashPassword("not-a-real-password");
    await verifyPassword(password, await dummyHash);
    return null;
  }
  if (!(await verifyPassword(password, user.passwordHash))) return null;
  return membershipFor(db, user.id, user.name, user.email);
}

export async function membershipFor(db: Db, userId: string, name?: string, email?: string): Promise<AuthedUser | null> {
  const [m] = await db.select().from(memberships).where(eq(memberships.userId, userId));
  if (!m) return null;
  if (name === undefined || email === undefined) {
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    if (!u) return null;
    return { userId, orgId: m.orgId, name: u.name, email: u.email };
  }
  return { userId, orgId: m.orgId, name, email };
}
