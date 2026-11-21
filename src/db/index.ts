import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DbOrTx = DB | Tx;

const globalForDb = globalThis as unknown as { __atlasSql?: postgres.Sql; __atlasDb?: DB };

function create(): DB {
  const url = process.env.DATABASE_URL;
  let client: postgres.Sql;
  if (url) {
    // Beheerde databases (Scaleway) vereisen een versleutelde verbinding.
    const ssl = /sslmode=(require|verify-full|verify-ca)/.test(url) || process.env.DATABASE_SSL === "require" ? "require" : undefined;
    client = postgres(url.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, ""), { max: 10, onnotice: () => {}, ssl });
  } else if (process.env.PGHOST) {
    // Losse velden (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE): geen gedoe met
    // speciale tekens in het wachtwoord.
    client = postgres({
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl: process.env.PGSSLMODE === "disable" ? false : "require",
      max: 10,
      onnotice: () => {},
    });
  } else {
    throw new Error("Databasegegevens ontbreken: zet DATABASE_URL of PGHOST/PGUSER/PGPASSWORD/PGDATABASE");
  }
  globalForDb.__atlasSql = client;
  return drizzle(client, { schema });
}

/** Lazy, zodat tests eerst DATABASE_URL kunnen zetten. */
export function getDb(): DB {
  if (!globalForDb.__atlasDb) globalForDb.__atlasDb = create();
  return globalForDb.__atlasDb;
}

export async function closeDb() {
  await globalForDb.__atlasSql?.end({ timeout: 5 });
  globalForDb.__atlasSql = undefined;
  globalForDb.__atlasDb = undefined;
}

export { schema };
