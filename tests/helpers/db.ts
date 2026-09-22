import { Client } from "pg";
import { connectPglite, connectPostgres, type Handle } from "@/lib/db/connect";

/**
 * Opens an isolated, migrated database for a test.
 * - Default: in-memory PostgreSQL (PGlite) — zero setup.
 * - With TEST_DATABASE_URL: a throwaway database on a real PostgreSQL server (dropped on close),
 *   so the same suite proves the production driver path too.
 */
export async function openTestDb(): Promise<Handle> {
  const admin = process.env.TEST_DATABASE_URL;
  if (!admin) return connectPglite();

  const name = `cuework_test_${Math.random().toString(36).slice(2, 10)}`;
  const client = new Client({ connectionString: admin });
  await client.connect();
  await client.query(`CREATE DATABASE ${name}`);
  await client.end();

  const url = new URL(admin);
  url.pathname = `/${name}`;
  const handle = await connectPostgres(url.toString());
  return {
    ...handle,
    close: async () => {
      await handle.close();
      const c = new Client({ connectionString: admin });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}
