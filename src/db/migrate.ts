import "dotenv/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "./index";
import { seedDefaults } from "./seed-defaults";

export async function runMigrations() {
  const db = getDb();
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  await seedDefaults(db);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.log("Migraties uitgevoerd");
      return closeDb();
    })
    .catch(async (e) => {
      console.error(e);
      await closeDb();
      process.exit(1);
    });
}
