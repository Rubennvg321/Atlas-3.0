import { expect, test } from "@playwright/test";

test("zijbalk: van klantenbord naar dashboard met de widget Bedrijfsstand", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Lokaal inloggen" }).click();
  await page.waitForURL("**/bord");

  const sidebar = page.getByRole("navigation", { name: "Onderdelen" });
  await expect(sidebar.getByRole("link", { name: "Klantenbord" })).toBeVisible();
  await sidebar.getByRole("link", { name: "Dashboard" }).click();
  await page.waitForURL("**/dashboard");

  await expect(page.getByRole("heading", { name: "Bedrijfsstand" })).toBeVisible();
  for (const label of ["Omzet deze maand", "Geplande omzet", "Nieuwe leads", "Akkoord", "Montages gepland"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
});
