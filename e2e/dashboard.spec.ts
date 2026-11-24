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
  await expect(page.getByRole("heading", { name: "Beste klant van de maand" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Kies een maand" })).toBeVisible();

  // Klik op "Omzet deze maand": overzicht per klant met keuzemenu en omzetdoel.
  await page.getByText("Omzet deze maand", { exact: true }).click();
  await page.waitForURL("**/dashboard?omzet=*");
  const picker = page.getByRole("combobox", { name: "Kies een maand of jaar" });
  await expect(picker).toBeVisible();
  await expect(page.getByText(/Omzetdoel per maand/).first()).toBeVisible();
  const year = String(new Date().getFullYear());
  await picker.selectOption(year);
  await page.waitForURL(`**/dashboard?omzet=${year}*`);
  await expect(page.getByRole("heading", { name: new RegExp(`^Omzet ${year}`) })).toBeVisible();
});
