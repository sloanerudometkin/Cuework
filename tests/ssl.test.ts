import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sslFromEnv } from "@/lib/db/connect";

describe("sslFromEnv", () => {
  it("defaults to no TLS for local development", () => {
    expect(sslFromEnv({})).toBe(false);
    expect(sslFromEnv({ DATABASE_SSL: "false" })).toBe(false);
  });
  it("'true' encrypts without verifying; 'verify' loads the CA and verifies", () => {
    expect(sslFromEnv({ DATABASE_SSL: "true" })).toEqual({ verify: false });
    const ca = path.join(os.tmpdir(), `ca-${Date.now()}.pem`);
    fs.writeFileSync(ca, "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n");
    expect(sslFromEnv({ DATABASE_SSL: "verify", DATABASE_SSL_CA_FILE: ca })).toEqual({ verify: true, ca: fs.readFileSync(ca, "utf8") });
    fs.rmSync(ca);
  });
  it("fails loudly (rather than silently downgrading) when 'verify' has no CA file", () => {
    expect(() => sslFromEnv({ DATABASE_SSL: "verify", DATABASE_SSL_CA_FILE: "/nonexistent/ca.pem" })).toThrow();
  });
});
