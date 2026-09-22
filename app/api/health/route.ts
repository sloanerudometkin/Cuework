import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/** Liveness + database readiness for the load balancer. Exposes no data and needs no auth. */
export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok" });
  } catch (e) {
    console.error("[health] database check failed", e);
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
