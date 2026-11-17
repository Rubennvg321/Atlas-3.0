import { execSync } from "node:child_process";

export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? "postgres://postgres@localhost:5432/atlas_e2e";
  execSync("npx tsx src/db/seed.ts", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
}
