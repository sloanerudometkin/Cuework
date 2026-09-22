import { config } from "dotenv";
import { connectPglite, connectPostgres, sslFromEnv } from "../lib/db/connect";

config({ path: ".env.local" });
config();

/** Same selection logic as the app: DATABASE_URL → PostgreSQL, otherwise embedded PGlite. */
export async function open() {
  const url = process.env.DATABASE_URL?.trim();
  return url
    ? connectPostgres(url, sslFromEnv())
    : connectPglite(process.env.CUEWORK_PGLITE_DIR || ".data/pglite");
}
