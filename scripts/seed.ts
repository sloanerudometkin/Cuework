import { ensureDemoWorkspace, resetDemoWorkspace } from "../lib/seed/demo";
import { open } from "./_db";

async function main() {
  const reset = process.argv.includes("--reset");
  const handle = await open();
  const started = Date.now();
  const result = reset ? await resetDemoWorkspace(handle.db) : await ensureDemoWorkspace(handle.db);
  console.log(`${reset ? "Rebuilt" : "Ensured"} the demo workspace in ${Date.now() - started}ms (org ${result.orgId}, ${handle.driver}).`);
  await handle.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
