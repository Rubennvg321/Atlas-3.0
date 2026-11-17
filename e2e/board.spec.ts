import { expect, test, type Browser, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Lokaal inloggen" }).click();
  await page.waitForURL("**/bord");
}

async function newDevice(browser: Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page);
  return page;
}

const card = (page: Page, name: string) => page.locator('[data-testid="card"]', { hasText: name });
const column = (page: Page, stage: string) => page.locator(`[data-stage="${stage}"]`);

async function drag(page: Page, name: string, toStage: string) {
  const from = await card(page, name).boundingBox();
  const to = await column(page, toStage).boundingBox();
  if (!from || !to) throw new Error("element niet gevonden");
  // Begin naast de naam (de naamlink zelf opent de detailpagina)
  await page.mouse.move(from.x + from.width - 12, from.y + 34);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width, from.y + 60, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 15 });
  await page.mouse.up();
}

/** Voert een actie uit en wacht tot de server de wijziging heeft bevestigd. */
async function saved(page: Page, action: () => Promise<unknown>) {
  const resp = page.waitForResponse((r) => r.request().method() === "POST" && r.request().headers()["next-action"] !== undefined);
  await action();
  await resp;
}

test("slepen en dropdown geven hetzelfde resultaat, ook na verversen en op een tweede apparaat", async ({ browser }) => {
  const a = await newDevice(browser);
  const b = await newDevice(browser);

  await expect(column(a, "lead").getByText("Jan van der Berg")).toBeVisible();

  // Apparaat A: slepen Lead -> Afspraak
  await saved(a, () => drag(a, "Jan van der Berg", "afspraak"));
  await expect(column(a, "afspraak").getByText("Jan van der Berg")).toBeVisible();
  await a.reload();
  await expect(column(a, "afspraak").getByText("Jan van der Berg")).toBeVisible();

  // Apparaat B ziet hetzelfde na verversen; dropdown staat op dezelfde fase
  await b.reload();
  await expect(column(b, "afspraak").getByText("Jan van der Berg")).toBeVisible();
  await expect(card(b, "Jan van der Berg").getByLabel("Fase")).toHaveValue("afspraak");

  // Apparaat B: dropdown -> Offerte
  await saved(b, () => card(b, "Jan van der Berg").getByLabel("Fase").selectOption("offerte"));
  await expect(column(b, "offerte").getByText("Jan van der Berg")).toBeVisible();

  // Apparaat A pakt het op (bij focus/periodiek verversen); hier: herladen
  await a.reload();
  await expect(column(a, "offerte").getByText("Jan van der Berg")).toBeVisible();
  await expect(card(a, "Jan van der Berg").getByLabel("Fase")).toHaveValue("offerte");

  // Detailpagina toont dezelfde fase en het logboek
  await card(a, "Jan van der Berg").getByRole("link", { name: "Jan van der Berg" }).click();
  await a.waitForURL("**/trajecten/**");
  await expect(a.getByLabel("Fase")).toHaveValue("offerte");
  await expect(a.getByText("Fase: Afspraak → Offerte")).toBeVisible();
  await expect(a.getByText("Fase: Lead → Afspraak")).toBeVisible();
});

test("verouderd scherm op tweede apparaat overschrijft niets", async ({ browser }) => {
  const a = await newDevice(browser);
  const b = await newDevice(browser);
  // B wijzigt eerst
  await saved(b, () => card(b, "Sanne Bakker").getByLabel("Fase").selectOption("afspraak"));
  await expect(column(b, "afspraak").getByText("Sanne Bakker")).toBeVisible();
  // A heeft nog het oude scherm en probeert iets anders
  await card(a, "Sanne Bakker").getByLabel("Fase").selectOption("offerte");
  await expect(a.getByText("ondertussen gewijzigd")).toBeVisible();
  // na verversen staat de kaart op de fase van B
  await a.reload();
  await expect(column(a, "afspraak").getByText("Sanne Bakker")).toBeVisible();
});

test("vervallen vraagt om een reden", async ({ page }) => {
  await login(page);
  await card(page, "Kees Meijer").getByLabel("Fase").selectOption("vervallen");
  await expect(page.getByText("Waarom is dit traject vervallen?")).toBeVisible();
  await page.getByRole("button", { name: "Concurrent" }).click();
  await saved(page, () => page.getByRole("button", { name: "Opslaan" }).click());
  await expect(card(page, "Kees Meijer")).toHaveCount(0); // vervallen is standaard verborgen
  await page.goto("/bord?vervallen=1");
  await expect(column(page, "vervallen").getByText("Kees Meijer")).toBeVisible();
  await expect(card(page, "Kees Meijer")).toContainText("Reden: Concurrent");
});

test("nieuwe klant met bestaand telefoonnummer wordt gekoppeld, niet dubbel", async ({ page }) => {
  await login(page);
  await page.goto("/klanten/nieuw");
  await page.getByLabel("Voornaam").fill("Fatima");
  await page.getByLabel("Achternaam").fill("El Amrani");
  await page.getByLabel("Telefoon", { exact: true }).fill("+31 6 23456789");
  await page.getByLabel("E-mail", { exact: true }).fill("f.elamrani@gmail.com");
  await page.getByRole("button", { name: "Opslaan" }).click();
  await expect(page.getByText("Deze klant bestond al")).toBeVisible();
  await page.goto("/klanten?q=El Amrani");
  await expect(page.locator("main li a", { hasText: "Fatima El Amrani" })).toHaveCount(1);
});
