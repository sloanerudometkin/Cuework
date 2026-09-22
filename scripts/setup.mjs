// First-run helper: creates .env.local with a fresh SESSION_SECRET. Never overwrites an existing file.
import { randomBytes } from "node:crypto";
import fs from "node:fs";

if (fs.existsSync(".env.local")) {
  console.log(".env.local already exists — leaving it untouched.");
} else {
  const template = fs.readFileSync(".env.example", "utf8");
  const secret = randomBytes(48).toString("base64");
  fs.writeFileSync(".env.local", template.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`));
  console.log("Created .env.local with a generated SESSION_SECRET.");
}
