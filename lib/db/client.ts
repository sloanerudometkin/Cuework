import "server-only";
import { connectPglite, connectPostgres, sslFromEnv, type Db, type Handle } from "./connect";

export type { Db };

const g = globalThis as unknown as { __cueworkDb?: Promise<Handle> };

/** Process-wide singleton (survives Next.js dev hot reloads). Migrates on first use. */
export function getHandle(): Promise<Handle> {
  if (!g.__cueworkDb) {
    const url = process.env.DATABASE_URL?.trim();
    g.__cueworkDb = url
      ? connectPostgres(url, sslFromEnv())
      : connectPglite(process.env.CUEWORK_PGLITE_DIR || ".data/pglite");
    g.__cueworkDb.catch(() => {
      g.__cueworkDb = undefined; // allow a retry after a transient failure
    });
  }
  return g.__cueworkDb;
}

export async function getDb(): Promise<Db> {
  return (await getHandle()).db;
}
