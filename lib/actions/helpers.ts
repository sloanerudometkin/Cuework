import "server-only";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireWorkspace, type WorkspaceContext } from "@/lib/auth/session";
import { ServiceError } from "@/lib/services/workspace";

export type { ActionResult } from "./types";
import type { ActionResult } from "./types";

/**
 * Wraps a mutation: authenticates (server actions are public POST endpoints, so
 * every one re-checks), turns expected failures into readable messages, and
 * refreshes every page that might show the changed data.
 */
export async function act<T>(fn: (ctx: WorkspaceContext) => Promise<T>): Promise<ActionResult<T>> {
  const ctx = await requireWorkspace();
  try {
    const data = await fn(ctx);
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ServiceError) return { ok: false, error: e.message };
    console.error("[action failed]", e);
    return { ok: false, error: "Something went wrong on our side. Please try again." };
  }
}
