import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 16384;
const KEYLEN = 64;

function derive(password: string, salt: Buffer, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, { N: n, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** scrypt$N$salt$hash (base64). Salted, memory-hard, no third-party dependency. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N);
  return `scrypt$${N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, n, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !n || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await derive(password, Buffer.from(saltB64, "base64"), Number(n));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
