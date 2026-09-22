import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Self-contained server bundle for the container image (AWS App Runner).
  output: "standalone",
  poweredByHeader: false,
  // Native/WASM database drivers must be required at runtime, not bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // SQL migrations are read from disk at boot, so make sure they ship in the trace.
  outputFileTracingIncludes: { "/**": ["./drizzle/**/*"] },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
