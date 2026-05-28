/**
 * Zajednički helperi za E2E punog klijentskog ciklusa.
 * Monolit `full-client-cycle.test.ts` ostaje samostalan; faze učitavaju ovaj modul.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

export const SPLASH_KEY = "crm_stolarija_rich_splash_done";

export const JOB_SUMMARY = "E2E-FULL-CYCLE-001";
export const CUSTOMER_FULL_NAME = "E2E-KLIJENT-001";

export const STATUS = {
  upit: "Upit",
  ponudaPoslata: "Ponuda poslata",
  prihvaceno: "Načelno prihvaćeno",
  merenje: "Merenje",
  obradaMera: "Obrada mera",
  finalnaPoslata: "Poslata finalna ponuda",
  finalnaCekaUplatu: "Finalna ponuda prihvaćena / Čeka uplatu",
  spremnoZaRad: "Spremno za rad",
  cekaMaterijal: "Čeka materijal",
  uProizvodnji: "U proizvodnji",
  cekaUgradnju: "Čeka ugradnju",
  ugradnjaUToku: "Ugradnja u toku",
  ugradnjaProblem: "Ugradnja – problem",
  ugradnjaZavrsenaNeplaceno: "Ugradnja završena / nije plaćeno",
  zavrsen: "Završen",
} as const;

export function baseUrl(): string {
  const u = process.env.PLAYWRIGHT_BASE_URL?.trim();
  if (!u) throw new Error("PLAYWRIGHT_BASE_URL je obavezan (.env.playwright).");
  return u;
}

export function pickCreds(emailVar: string, passVar: string, fallbackEmail: string, fallbackPass: string) {
  const e = process.env[emailVar]?.trim() || fallbackEmail;
  const p = process.env[passVar]?.trim() || fallbackPass;
  return { email: e, password: p };
}

export async function bypassSplash(page: Page) {
  await page.addInitScript((key: string) => {
    try {
      sessionStorage.setItem(key, "1");
    } catch {
      /* ignore */
    }
  }, SPLASH_KEY);
}

export async function login(page: Page, email: string, password: string) {
  await bypassSplash(page);
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Prijavi se" }).click();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 60_000 });
}

export async function expectJobStatusBadge(page: Page, label: string | RegExp) {
  const badge = page.locator("span.rounded-full").filter({ hasText: label }).first();
  await expect(badge).toBeVisible({ timeout: 120_000 });
}

export function minimalPdfAsFile() {
  const body = `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 3 3]>>endobj
trailer<</Root 1 0 R>>
%%EOF`;
  return {
    name: "e2e-quote.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(body, "latin1"),
  };
}

/** 1×1 PNG za montažni izveštaj (obavezna fotodokumentacija). */
export function minimalPngFile() {
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return {
    name: "e2e-site.png",
    mimeType: "image/png",
    buffer: Buffer.from(b64, "base64"),
  };
}

export function cutListCsv() {
  return {
    name: "e2e-cutlist.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "profile_code;profile_title;color;cut_lenght;quantity;user_barcode\nP-E2E;E2E profil;bela;2500;2;E2E_BAR_001\n",
      "utf8",
    ),
  };
}

export async function deleteCustomerAndJobsByName(admin: Page, customerName: string) {
  await admin.goto("/jobs", { waitUntil: "domcontentloaded" });
  const customersTab = admin.getByRole("tab", { name: /Klijenti/i });
  if ((await customersTab.count()) === 0) return;
  await customersTab.click();
  await admin.getByPlaceholder(/Pretraži po imenu, emailu ili telefonu/i).fill(customerName);
  const row = admin.locator("tbody tr").filter({ hasText: customerName }).first();
  if ((await row.count()) === 0) return;
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.getByRole("button").last().click();
  const dlg = admin.getByRole("alertdialog").filter({ hasText: /Obrisati klijenta/i });
  await expect(dlg).toBeVisible({ timeout: 10_000 });
  await dlg.getByRole("button", { name: /Obriši klijenta/i }).click();
  await expect(dlg).toBeHidden({ timeout: 30_000 });
}

/** USB barkod: brzi unos + Enter (OrderReception / global listener). */
export async function simulateUsbBarcode(page: Page, code: string) {
  await page.locator("body").click({ position: { x: 4, y: 4 } });
  await page.waitForTimeout(80);
  await page.keyboard.type(code, { delay: 18 });
  await page.keyboard.press("Enter");
}

export async function extractProcurementBarcodeFromReception(page: Page): Promise<string> {
  const line = page.getByText(/^Barkod:\s*/).first();
  await expect(line).toBeVisible({ timeout: 60_000 });
  const t = (await line.textContent())?.trim() ?? "";
  const m = t.match(/Barkod:\s*(.+)/i);
  if (!m?.[1]) throw new Error(`Ne mogu da parsiram barkod iz: ${t}`);
  return m[1].trim();
}

export async function fillMaterialOrderAndSend(admin: Page) {
  await admin.getByRole("button", { name: /Nova narudžbina/i }).click();
  await expect(admin.getByRole("dialog", { name: /Nova narudžbina/i })).toBeVisible({ timeout: 30_000 });

  await admin.getByLabel(/^Dobavljač$/i).click();
  const firstSupplier = admin.getByRole("option").first();
  await expect(firstSupplier).toBeVisible({ timeout: 15_000 });
  await firstSupplier.click();

  await admin.getByRole("textbox", { name: /Naziv \/ opis/i }).first().fill("E2E materijal profil");
  await admin.getByRole("spinbutton", { name: /^Količina$/i }).first().fill("10");
  await admin.getByRole("textbox", { name: /^JM$/i }).first().fill("kom");

  await admin.getByRole("button", { name: /Kreiraj narudžbinu/i }).click();
  await expect(admin.getByRole("dialog", { name: /Nova narudžbina/i })).toBeHidden({ timeout: 120_000 });

  await admin.getByRole("button", { name: /Pošalji porudžbinu dobavljaču/i }).first().click();
  await expect(admin.getByRole("dialog", { name: /Pošalji porudžbinu dobavljaču/i })).toBeVisible({ timeout: 30_000 });
  await admin.getByRole("button", { name: /Označi kao poslato/i }).click();
  await expect(admin.getByRole("dialog", { name: /Pošalji porudžbinu dobavljaču/i })).toBeHidden({ timeout: 60_000 });

  const proformaBtn = admin.getByRole("button", { name: /Sačuvaj predračun i ažuriraj status/i });
  await expect(proformaBtn).toBeVisible({ timeout: 45_000 });
  await admin.locator('input[id^="proforma-file-"]').first().setInputFiles(minimalPdfAsFile());
  await admin.locator('input[id^="proforma-total-"]').first().fill("15000");
  await proformaBtn.click();
  await expect(proformaBtn).toBeDisabled({ timeout: 5_000 }).catch(() => {});
  await admin.waitForTimeout(2500);

  await admin.getByRole("button", { name: /Faktura \/ plaćanje/i }).first().click();
  const invDlg = admin.getByRole("dialog", { name: /Evidencija fakture/i });
  await expect(invDlg).toBeVisible({ timeout: 30_000 });
  await invDlg.locator("#inv-amount").fill("15000");
  await invDlg.getByRole("button", { name: /Sačuvaj evidenciju/i }).click();
  await expect(invDlg).toBeHidden({ timeout: 120_000 });
}

/** U dijalogu „Zakaži ugradnju“ / „Ponovo zakazite ugradnju“. */
export async function pickFirstTeamInInstallationScheduleDialog(page: Page) {
  const dlg = page.getByRole("dialog", { name: /Zakaži ugradnju|Ponovo zakazite ugradnju/i });
  await dlg.getByRole("combobox").click();
  await page.getByRole("option").first().click();
}

export async function assignFirstTeamToInstallation(admin: Page) {
  await admin.getByRole("tab", { name: /Nalozi/i }).click();
  const installCard = admin
    .locator(".bg-card.rounded-xl")
    .filter({ hasText: /Ugradnja|Montaža/i })
    .filter({ hasText: /Na čekanju/i })
    .last();
  await expect(installCard).toBeVisible({ timeout: 90_000 });
  const dodeli = installCard.getByRole("button", { name: /Dodeli tim/i });
  if ((await dodeli.count()) === 0) return;
  await dodeli.click();
  const pop = admin.locator("[data-radix-popper-content-wrapper]").last();
  await pop.getByRole("combobox").click();
  await admin.getByRole("option").first().click();
  await pop.getByRole("button", { name: /^Sačuvaj$/i }).click();
  await expect(pop).toBeHidden({ timeout: 30_000 }).catch(() => {});
}

/** Uloga montaže u CRM-u (env: `E2E_FULL_CYCLE_MONTAZNIK_*`). */
export async function montazaOpenInstallationReport(montaza: Page, jobUrl: string) {
  await montaza.goto(jobUrl, { waitUntil: "domcontentloaded" });
  await montaza.getByRole("tab", { name: /Nalozi/i }).click();
  const card = montaza
    .locator(".bg-card.rounded-xl")
    .filter({ hasText: /Ugradnja|Montaža/i })
    .filter({ hasText: /Na čekanju/i })
    .last();
  await expect(card).toBeVisible({ timeout: 90_000 });
  const pokreni = card.getByRole("button", { name: /^Pokreni$/ });
  if (await pokreni.isVisible()) await pokreni.click();
  await card.getByRole("button", { name: /Dodaj izveštaj|Završi/i }).click();
  await expect(montaza.getByRole("dialog")).toBeVisible({ timeout: 30_000 });
}

/** Dijalog ugradbenog izveštaja — `montaza` je sesija uloge montaže. */
export async function fillMountingReportBasics(montaza: Page, notes: string) {
  const dlg = montaza.getByRole("dialog");
  const addr = dlg.getByPlaceholder(/Unesite adresu/i);
  if (await addr.isVisible()) {
    const v = await addr.inputValue();
    if (!v.trim()) await addr.fill("E2E adresa ugradnje, Beograd");
  }
  const imgInput = dlg.locator('input[type="file"][accept*="image"]').first();
  await imgInput.setInputFiles(minimalPngFile());
  await dlg.getByPlaceholder(/Kratak rezime|Opis izvršenih|generalni/i).fill(notes);
}

/**
 * Prodaja otvara kontrolnu tablu. Sivi „Neraspoređeni radni nalozi“ postoji samo dok RPC vrati bar jedan RN
 * bez tima / prihvaćen posao bez kompletnog zakazivanja merenja — posle „Zakaži merenje“ sa timom često je prazan.
 */
export async function expectProdajaDashboardOptionalUnscheduledBanner(prodaja: Page, opts?: { bannerWaitMs?: number }) {
  const wait = opts?.bannerWaitMs ?? 25_000;
  await prodaja.goto("/", { waitUntil: "domcontentloaded" });
  await expect(prodaja.getByRole("heading", { name: /^Kontrolna tabla$/i })).toBeVisible({ timeout: 30_000 });
  const gray = prodaja.getByRole("alert").filter({ hasText: /Neraspoređeni radni nalozi/i });
  try {
    await gray.waitFor({ state: "visible", timeout: wait });
    await expect(gray).toHaveClass(/bg-muted/);
  } catch {
    test.info().attach("prodaja-unscheduled-banner", {
      body:
        "Banner „Neraspoređeni radni nalozi“ se nije pojavio u roku — uobičajeno posle zakazivanja merenja sa timom (RN više nije „bez tima“), ili na stagingu nema drugih neraspoređenih naloga.",
      contentType: "text/plain",
    });
  }
}
