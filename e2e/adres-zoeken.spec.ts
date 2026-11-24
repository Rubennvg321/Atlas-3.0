import { expect, test } from "@playwright/test";

test("adres zoeken via Google: uitleg zolang er geen sleutel is, en instellen via Koppelingen", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Lokaal inloggen" }).click();
  await page.waitForURL("**/bord");

  await page.goto("/klanten/nieuw");
  const search = page.getByRole("combobox", { name: /Adres zoeken via Google/ });
  await search.fill("Kerkstraat 12");
  await expect(page.getByText("Adres zoeken via Google staat nog uit.")).toBeVisible();

  await page.getByRole("link", { name: "Koppelingen" }).last().click();
  await page.waitForURL("**/koppelingen");
  await expect(page.getByText("Adres zoeken via Google", { exact: false }).first()).toBeVisible();
  await expect(page.getByPlaceholder(/begint met AIza/)).toBeVisible();
});
