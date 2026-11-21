import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://postgres@localhost:5432/atlas_e2e";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://localhost:${PORT}`, trace: "off" },
  globalSetup: "./e2e/global-setup.ts",
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { DATABASE_URL, AUTH_DEV_BYPASS: "1", AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-123", AUTH_URL: `http://localhost:${PORT}` },
  },
});
