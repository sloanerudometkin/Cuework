import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import * as schema from "./schema";

/** Driver-agnostic database handle: services depend on this, never on a specific driver. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };

const MIGRATIONS = () => path.join(process.cwd(), "drizzle");

export interface Handle {
  db: Db;
  driver: "postgres" | "pglite";
  close: () => Promise<void>;
}

export type PostgresSsl = false | { verify: false } | { verify: true; ca: string };

/**
 * Reads DATABASE_SSL: "false" (default) | "true" (encrypt, don't verify the server) |
 * "verify" (encrypt AND verify against the CA bundle in DATABASE_SSL_CA_FILE — use this on RDS).
 */
export function sslFromEnv(env: Record<string, string | undefined> = process.env): PostgresSsl {
  const mode = env.DATABASE_SSL?.trim().toLowerCase();
  if (mode === "verify") {
    const file = env.DATABASE_SSL_CA_FILE || path.join(process.cwd(), "certs", "rds-global-bundle.pem");
    return { verify: true, ca: fs.readFileSync(file, "utf8") };
  }
  return mode === "true" ? { verify: false } : false;
}

/** Real PostgreSQL (Amazon RDS etc.). */
export async function connectPostgres(url: string, ssl: PostgresSsl | boolean = false): Promise<Handle> {
  const opts: PostgresSsl = ssl === true ? { verify: false } : ssl;
  const pool = new Pool({
    connectionString: url,
    ssl: opts === false ? undefined : opts.verify ? { ca: opts.ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
    max: 10,
  });
  const db = drizzlePg(pool, { schema });
  await migratePg(db, { migrationsFolder: MIGRATIONS() });
  return { db, driver: "postgres", close: () => pool.end() };
}

/** Embedded PostgreSQL (PGlite). `dataDir` omitted = in-memory (used by tests). */
export async function connectPglite(dataDir?: string): Promise<Handle> {
  if (dataDir) fs.mkdirSync(path.dirname(path.resolve(dataDir)), { recursive: true });
  const client = new PGlite(dataDir ? path.resolve(dataDir) : undefined);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS() });
  return { db, driver: "pglite", close: () => client.close() };
}
