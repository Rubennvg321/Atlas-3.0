import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DbOrTx = DB | Tx;

const globalForDb = globalThis as unknown as { __atlasSql?: postgres.Sql; __atlasDb?: DB };

function create(): DB {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL ontbreekt");
  const client = postgres(url, { max: 10, onnotice: () => {} });
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
