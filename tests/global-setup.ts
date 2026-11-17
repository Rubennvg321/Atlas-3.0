import { execSync } from "node:child_process";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/atlas_test";
  execSync("npx tsx src/db/migrate.ts", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
}
