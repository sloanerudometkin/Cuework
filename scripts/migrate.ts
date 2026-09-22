import { open } from "./_db";

async function main() {
  // Opening the connection applies any pending migrations.
  const handle = await open();
  console.log(`Migrations applied (${handle.driver}).`);
  await handle.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
