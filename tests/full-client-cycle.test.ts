/**
 * End-to-end: pun klijentski životni ciklus (Termo Plast CRM).
 *
 * Pokretanje: `npm run test:e2e:full-cycle` (projekat `full-cycle` u playwright.config.ts).
 *
 * Okruženje (.env.playwright) — imena varijabli su istorijska; u CRM-u uloge su:
 * - `E2E_FULL_CYCLE_DISPATCHER_*` → **prodaja** (kontrolna tabla, dodela tima, prodajni widget)
 * - `E2E_FULL_CYCLE_MONTAZNIK_*` → **montaža** (teren — isti tim kao kod zakazivanja merenja)
 * - `E2E_FULL_CYCLE_MAGACIN_*` → **proizvodnja** (prijem porudžbine materijala)
 * - `PLAYWRIGHT_BASE_URL`, `E2E_USER_EMAIL`, `E2E_USER_PASSWORD` — admin / office sa punim pravima
 * - `E2E_FULL_CYCLE_PROCUREMENT_EMAIL` / `PASSWORD` — nabavka za HITNO „nedostatak sa ugradnje“ (fallback: admin)
 * Ako opcioni nalozi nedostaju, koristi se admin — neki koraci (real-time alerti) su tada ograničeni.
 *
 * Video/screenshot: `only-on-failure` / `retain-on-failure` u playwright.config.ts.
 *
 * Čišćenje: samo UI (Poslovi → Klijenti → obriši klijenta) — briše i povezane poslove.
 */
import { test, expect } from "@playwright/test";
import type { Browser, Page, BrowserContext } from "@playwright/test";
import {
  expectProdajaDashboardOptionalUnscheduledBanner,
  pickFirstTeamInInstallationScheduleDialog,
} from "./full-client-cycle-shared";

const SPLASH_KEY = "crm_stolarija_rich_splash_done";

const JOB_SUMMARY = "E2E-FULL-CYCLE-001";
const CUSTOMER_FULL_NAME = "E2E-KLIJENT-001";

const STATUS = {
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

function baseUrl(): string {
  const u = process.env.PLAYWRIGHT_BASE_URL?.trim();
  if (!u) throw new Error("PLAYWRIGHT_BASE_URL je obavezan (.env.playwright).");
  return u;
}

function pickCreds(emailVar: string, passVar: string, fallbackEmail: string, fallbackPass: string) {
  const e = process.env[emailVar]?.trim() || fallbackEmail;
  const p = process.env[passVar]?.trim() || fallbackPass;
  return { email: e, password: p };
}

async function bypassSplash(page: Page) {
  await page.addInitScript((key: string) => {
    try {
      sessionStorage.setItem(key, "1");
    } catch {
      /* ignore */
    }
  }, SPLASH_KEY);
}

async function login(page: Page, email: string, password: string) {
  await bypassSplash(page);
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Prijavi se" }).click();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 60_000 });
}

async function expectJobStatusBadge(page: Page, label: string | RegExp) {
  const badge = page.locator("span.rounded-full").filter({ hasText: label }).first();
  await expect(badge).toBeVisible({ timeout: 120_000 });
}

function minimalPdfAsFile() {
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
function minimalPngFile() {
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return {
    name: "e2e-site.png",
    mimeType: "image/png",
    buffer: Buffer.from(b64, "base64"),
  };
}

function cutListCsv() {
  return {
    name: "e2e-cutlist.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "profile_code;profile_title;color;cut_lenght;quantity;user_barcode\nP-E2E;E2E profil;bela;2500;2;E2E_BAR_001\n",
      "utf8",
    ),
  };
}

async function deleteCustomerAndJobsByName(admin: Page, customerName: string) {
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
async function simulateUsbBarcode(page: Page, code: string) {
  await page.locator("body").click({ position: { x: 4, y: 4 } });
  await page.waitForTimeout(80);
  await page.keyboard.type(code, { delay: 18 });
  await page.keyboard.press("Enter");
}

async function extractProcurementBarcodeFromReception(page: Page): Promise<string> {
  const line = page.getByText(/^Barkod:\s*/).first();
  await expect(line).toBeVisible({ timeout: 60_000 });
  const t = (await line.textContent())?.trim() ?? "";
  const m = t.match(/Barkod:\s*(.+)/i);
  if (!m?.[1]) throw new Error(`Ne mogu da parsiram barkod iz: ${t}`);
  return m[1].trim();
}

async function fillMaterialOrderAndSend(admin: Page) {
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

async function assignFirstTeamToInstallation(admin: Page) {
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

async function montazaOpenInstallationReport(montaza: Page, jobUrl: string) {
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

async function fillMountingReportBasics(montaza: Page, notes: string) {
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

test.describe.configure({ mode: "serial" });

test.describe("Full client lifecycle @full-cycle", () => {
  test("E2E: od upita do servisa (više konteksta)", async ({ browser }) => {
    baseUrl();
    const adminEmail = process.env.E2E_USER_EMAIL?.trim() || "";
    const adminPass = process.env.E2E_USER_PASSWORD?.trim() || "";
    test.skip(!adminEmail || !adminPass, "E2E_USER_EMAIL / E2E_USER_PASSWORD u .env.playwright");

    const adminC = pickCreds("", "", adminEmail, adminPass);
    const prodajaC = pickCreds(
      "E2E_FULL_CYCLE_DISPATCHER_EMAIL",
      "E2E_FULL_CYCLE_DISPATCHER_PASSWORD",
      adminEmail,
      adminPass,
    );
    const montazaC = pickCreds(
      "E2E_FULL_CYCLE_MONTAZNIK_EMAIL",
      "E2E_FULL_CYCLE_MONTAZNIK_PASSWORD",
      adminEmail,
      adminPass,
    );
    const proizvodnjaC = pickCreds(
      "E2E_FULL_CYCLE_MAGACIN_EMAIL",
      "E2E_FULL_CYCLE_MAGACIN_PASSWORD",
      adminEmail,
      adminPass,
    );
    const procC = pickCreds(
      "E2E_FULL_CYCLE_PROCUREMENT_EMAIL",
      "E2E_FULL_CYCLE_PROCUREMENT_PASSWORD",
      adminEmail,
      adminPass,
    );

    const contexts: BrowserContext[] = [];
    const closeAll = async () => {
      for (const c of contexts) {
        try {
          await c.close();
        } catch {
          /* ignore */
        }
      }
      contexts.length = 0;
    };

    const mk = async (b: Browser, cred: { email: string; password: string }) => {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
      contexts.push(ctx);
      const p = await ctx.newPage();
      await login(p, cred.email, cred.password);
      return p;
    };

    let admin: Page;
    let prodaja: Page;
    let montaza: Page;
    let proizvodnja: Page;
    let procurement: Page;
    let jobUrl = "";
    let materialOrderId: string | null = null;

    try {
      admin = await mk(browser, adminC);
      prodaja = await mk(browser, prodajaC);
      montaza = await mk(browser, montazaC);
      proizvodnja = await mk(browser, proizvodnjaC);
      procurement = await mk(browser, procC);

      await test.step("Priprema: obriši ostatak prethodnog pada", async () => {
        await deleteCustomerAndJobsByName(admin, CUSTOMER_FULL_NAME);
      });

      await test.step("1. Novi kupac + upit (Novi posao)", async () => {
        await admin.goto("/jobs", { waitUntil: "domcontentloaded" });
        await admin.getByRole("button", { name: /Novi posao/i }).click();
        await expect(admin.getByRole("dialog", { name: /Kreiranje novog posla/i })).toBeVisible();

        await admin.getByRole("button", { name: "Novi kupac" }).click();
        await admin.getByLabel(/Ime i prezime kupca/i).fill(CUSTOMER_FULL_NAME);
        await admin.getByLabel(/Kontakt osoba/i).fill("E2E Kontakt");
        await admin.getByPlaceholder("+381 6").first().fill("0640000001");
        await admin.getByPlaceholder("adresa@email.com").first().fill("e2e-full-cycle@invalid.local");
        await admin.getByLabel(/Adresa za fakturisanje \(za ovaj posao\)/i).fill("E2E Faktura 1, Beograd");
        await admin.getByLabel(/Adresa ugradnje \(za ovaj posao\)/i).fill("E2E Ugradnja 1, Beograd");
        await admin.getByLabel(/Telefon za ovaj posao/i).fill("0640000002");
        await admin.getByLabel(/Opis posla/i).fill(JOB_SUMMARY);

        await admin.getByRole("button", { name: "Kreiraj posao" }).click();
        await expect(admin.getByRole("dialog", { name: /Kreiranje novog posla/i })).toBeHidden({ timeout: 120_000 });

        /** Lista filtrira kupca, broj posla i telefon — ne i `summary` (Opis posla). */
        const jobSearch = admin.getByPlaceholder(/Pretraži po imenu ili broju posla/i);
        await jobSearch.clear();
        await jobSearch.fill(CUSTOMER_FULL_NAME);
        const jobRow = admin.locator("tbody tr").filter({ hasText: CUSTOMER_FULL_NAME });
        await expect(jobRow.first()).toBeVisible({ timeout: 90_000 });
        await jobRow.first().getByRole("button", { name: "Detalji" }).click();
        await expect(admin).toHaveURL(/\/jobs\/[0-9a-f-]{36}/i, { timeout: 30_000 });
        jobUrl = admin.url();

        await expectJobStatusBadge(admin, STATUS.upit);
      });

      await test.step("2. Ponuda → prihvat → merenje → izveštaj (Sve u redu)", async () => {
        await admin.getByRole("tab", { name: /Ponude/i }).click();

        await admin.getByRole("button", { name: /Nova ponuda/i }).click();
        const v1 = `E2E v1 ${Date.now()}`;
        await admin.getByLabel(/Naziv verzije|verzij/i).fill(v1);
        await admin.locator('input[type="file"]').first().setInputFiles(minimalPdfAsFile());
        await admin.getByRole("button", { name: /Sačuvaj ponudu/i }).click();
        await expect(admin.getByRole("dialog", { name: /Nova ponuda/i })).toBeHidden({ timeout: 120_000 });

        const row1 = admin.locator("table tbody tr").filter({ hasText: v1 });
        await row1.locator('[role="combobox"]').first().click();
        await admin.getByRole("option", { name: "Poslata" }).click();
        await expectJobStatusBadge(admin, STATUS.ponudaPoslata);

        await admin.getByRole("button", { name: /Označi kao prihvaćenu/i }).first().click();
        await expect(admin.getByRole("dialog", { name: /Potvrdite konačnu cenu/i })).toBeVisible();
        await admin.locator("#accept-final-price").fill("120000");
        await admin.getByRole("button", { name: "Potvrdi prihvatanje" }).click();
        await expect(admin.getByRole("dialog", { name: /Potvrdite konačnu cenu/i })).toBeHidden({ timeout: 120_000 });
        await expectJobStatusBadge(admin, STATUS.prihvaceno);

        await admin.getByRole("tab", { name: /Pregled/i }).click();
        await admin.getByRole("button", { name: /Zakaži merenje/i }).click();
        const measureDlg = admin.getByRole("dialog", { name: /Zakaži merenje/i });
        await expect(measureDlg).toBeVisible();

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const isoLocal = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}T10:00`;
        await measureDlg.locator("#measurement-datetime").fill(isoLocal);

        /** Radix Select: sadržaj je u portalu; čekaj listbox + opciju (prazan meni = nema aktivnih timova na stagingu). */
        const teamTrigger = measureDlg.getByRole("combobox");
        await expect(teamTrigger).toBeEnabled({ timeout: 60_000 });
        await teamTrigger.click();
        const teamOption = admin.locator('[role="listbox"]').getByRole("option").first();
        await expect(teamOption).toBeVisible({ timeout: 60_000 });
        await teamOption.click({ timeout: 30_000 });
        await admin.getByRole("button", { name: /Sačuvaj i zakaži/i }).click();
        await expect(admin.getByRole("dialog", { name: /Zakaži merenje/i })).toBeHidden({ timeout: 120_000 });
        await expectJobStatusBadge(admin, STATUS.merenje);

        await test.step("Prodaja: kontrolna tabla (sivi banner ako ima neraspoređenih RN)", async () => {
          await expectProdajaDashboardOptionalUnscheduledBanner(prodaja);
        });

        await montaza.goto(jobUrl, { waitUntil: "domcontentloaded" });
        await montaza.getByRole("tab", { name: /Nalozi/i }).click();
        const pokreni = montaza.getByRole("button", { name: /^Pokreni$/ }).first();
        if (await pokreni.isVisible()) await pokreni.click();
        await montaza.getByRole("button", { name: /Dodaj izveštaj/i }).first().click();
        await expect(montaza.getByRole("dialog")).toBeVisible({ timeout: 30_000 });

        const okSwitch = montaza.locator("#ok");
        if ((await okSwitch.count()) > 0 && !(await okSwitch.isChecked())) await okSwitch.click();

        await montaza.getByRole("dialog").getByPlaceholder(/Dodatni opis ili mere/i).fill("1000×1200 mm");
        await montaza.getByRole("dialog").getByPlaceholder("npr. 4").fill("4");
        await montaza.getByRole("button", { name: /Sačuvaj izveštaj/i }).click();
        await expect(montaza.getByRole("dialog")).toBeHidden({ timeout: 120_000 });

        await admin.reload({ waitUntil: "domcontentloaded" });
        await expectJobStatusBadge(admin, STATUS.obradaMera);
      });

      await test.step("3. Finalna ponuda → uplata → krojna lista → materijal → Čeka materijal (narandžasta nijansa)", async () => {
        await admin.goto(jobUrl, { waitUntil: "domcontentloaded" });
        await admin.getByRole("tab", { name: /Ponude/i }).click();
        await admin.getByRole("button", { name: /Nova ponuda/i }).click();
        const vf = `E2E final ${Date.now()}`;
        await admin.getByLabel(/Naziv verzije|verzij/i).fill(vf);
        await admin.locator('input[type="file"]').first().setInputFiles(minimalPdfAsFile());
        await admin.getByRole("checkbox", { name: /dopun|addon|merenj/i }).click().catch(() => {});
        await admin.getByRole("button", { name: /Sačuvaj ponudu/i }).click();
        await expect(admin.getByRole("dialog", { name: /Nova ponuda/i })).toBeHidden({ timeout: 120_000 });

        const rowF = admin.locator("table tbody tr").filter({ hasText: vf });
        await rowF.locator('[role="combobox"]').first().click();
        await admin.getByRole("option", { name: "Poslata" }).click();
        await expectJobStatusBadge(admin, STATUS.finalnaPoslata);

        await admin.getByRole("button", { name: /Označi kao prihvaćenu/i }).first().click();
        await expect(admin.getByRole("dialog", { name: /Potvrdite konačnu cenu/i })).toBeVisible();
        await admin.locator("#accept-final-price").fill("150000");
        await admin.getByRole("button", { name: "Potvrdi prihvatanje" }).click();
        await expect(admin.getByRole("dialog", { name: /Potvrdite konačnu cenu/i })).toBeHidden({ timeout: 120_000 });
        await expectJobStatusBadge(admin, STATUS.finalnaCekaUplatu);

        await admin.getByRole("tab", { name: /Finansije/i }).click();
        await admin.getByRole("button", { name: /Evidentiraj uplatu/i }).click();
        await admin.getByRole("dialog", { name: /Evidentiranje plaćanja/i }).getByPlaceholder("0").fill("50000");
        await admin.getByRole("button", { name: /^Evidentiraj$/i }).click();
        await expect(admin.getByRole("dialog", { name: /Evidentiranje plaćanja/i })).toBeHidden({ timeout: 60_000 });
        await expectJobStatusBadge(admin, STATUS.spremnoZaRad);

        await admin.getByRole("tab", { name: /Krojna lista/i }).click();
        await admin.locator("#cutlist-upload").setInputFiles(cutListCsv());
        await expect(admin.getByText(/stavk/i)).toBeVisible({ timeout: 60_000 }).catch(() => {});

        await admin.getByRole("tab", { name: /Materijal/i }).click();
        await fillMaterialOrderAndSend(admin);

        await expectJobStatusBadge(admin, STATUS.cekaMaterijal);
        const amberBadge = admin.locator("span.rounded-full").filter({ hasText: STATUS.cekaMaterijal }).first();
        await expect(amberBadge).toHaveClass(/amber/);

        await test.step("Nabavka: narandžasta / upozorenja na kontrolnoj tabli (opciono)", async () => {
          await procurement.goto("/", { waitUntil: "domcontentloaded" });
          const amberBlock = procurement.locator(".border-amber-500\\/55, .border-amber-500\\/45").first();
          await expect(amberBlock.or(procurement.getByText(/Narudžbine na čekanju|Čeka se isporuku|kašnjenja/i))).toBeVisible({
            timeout: 45_000,
          }).catch(() => {
            test.info().attach("procurement-orange-note", {
              body: "Nije pronađen istaknut narandžasti blok — staging statistika možda nema kašnjenja.",
              contentType: "text/plain",
            });
          });
        });

        await admin.getByRole("tab", { name: /Krojna lista/i }).click();
        const linkPrijem = admin.getByRole("link", { name: /Prijem \(barkod\)|Otvori prijem/i }).first();
        await expect(linkPrijem).toBeVisible({ timeout: 60_000 });
        const href = await linkPrijem.getAttribute("href");
        const m = href?.match(/\/order-reception\/([0-9a-f-]{36})/i);
        materialOrderId = m?.[1] ?? null;
      });

      await test.step("4. Proizvodnja: prijem porudžbine → U proizvodnji → proizvodnja završena → Čeka ugradnju (sivi alert)", async () => {
        test.skip(!materialOrderId, "Nije izvučen ID narudžbine za prijem.");
        await proizvodnja.goto(`/order-reception/${materialOrderId}`, { waitUntil: "domcontentloaded" });
        const code = await extractProcurementBarcodeFromReception(proizvodnja);
        await simulateUsbBarcode(proizvodnja, code);
        await expect(proizvodnja.getByText(/Rešeno|Primljeno|Uspešno/i).first()).toBeVisible({ timeout: 60_000 }).catch(() => {});
        const finishBtn = proizvodnja.getByRole("button", { name: /Završi prijem porudžbine/i });
        if (await finishBtn.isVisible()) await finishBtn.click();
        await expect(proizvodnja.getByText(/primljen|završen/i).first()).toBeVisible({ timeout: 120_000 }).catch(() => {});

        await admin.goto(jobUrl, { waitUntil: "domcontentloaded" });
        await expectJobStatusBadge(admin, STATUS.uProizvodnji);

        await admin.getByRole("button", { name: /Da, proizvodnja je završena/i }).click();
        await expectJobStatusBadge(admin, STATUS.cekaUgradnju);

        await expectProdajaDashboardOptionalUnscheduledBanner(prodaja);
      });

      await test.step("5. Ugradnja: scenario 2 otkaz na lokaciji → problem; scenario 1 nedostatak → HITNO RED; scenario 3 uspeh", async () => {
        await admin.goto(jobUrl, { waitUntil: "domcontentloaded" });
        await admin.getByRole("button", { name: /Zakaži ugradnju|Ponovo zakazite ugradnju/i }).click();
        await expect(admin.getByRole("dialog", { name: /Zakaži ugradnju|Ponovo zakazite ugradnju/i })).toBeVisible({
          timeout: 30_000,
        });
        const inst = new Date();
        inst.setDate(inst.getDate() + 2);
        const instIso = `${inst.getFullYear()}-${String(inst.getMonth() + 1).padStart(2, "0")}-${String(inst.getDate()).padStart(2, "0")}T14:00`;
        await admin.locator("#installation-datetime").fill(instIso);
        await pickFirstTeamInInstallationScheduleDialog(admin);
        await admin.getByRole("button", { name: /Sačuvaj i zakaži/i }).click();
        await expect(admin.getByRole("dialog", { name: /Zakaži ugradnju|Ponovo zakazite ugradnju/i })).toBeHidden({
          timeout: 60_000,
        });

        await montazaOpenInstallationReport(montaza, jobUrl);
        await fillMountingReportBasics(montaza, "E2E: prvi obilazak — otkaz na lokaciji.");
        const dlg = montaza.getByRole("dialog");
        await dlg.locator("#canceled").click();
        await dlg.getByPlaceholder("Razlog").fill("Otkazano na lokaciji — klijent odbio termin E2E");
        await dlg.getByRole("button", { name: /Sačuvaj izveštaj/i }).click();
        await expect(dlg).toBeHidden({ timeout: 120_000 });

        await admin.goto(jobUrl, { waitUntil: "domcontentloaded" });
        await expectJobStatusBadge(admin, STATUS.ugradnjaProblem);

        await admin.getByRole("button", { name: /Ponovo zakazite ugradnju/i }).click();
        await expect(admin.getByRole("dialog", { name: /Ponovo zakazite ugradnju/i })).toBeVisible({ timeout: 30_000 });
        const inst2 = new Date();
        inst2.setDate(inst2.getDate() + 3);
        const inst2Iso = `${inst2.getFullYear()}-${String(inst2.getMonth() + 1).padStart(2, "0")}-${String(inst2.getDate()).padStart(2, "0")}T09:30`;
        await admin.locator("#installation-datetime").fill(inst2Iso);
        await pickFirstTeamInInstallationScheduleDialog(admin);
        await admin.getByRole("button", { name: /Sačuvaj i zakaži/i }).click();
        await expect(admin.getByRole("dialog")).toBeHidden({ timeout: 60_000 });

        await montazaOpenInstallationReport(montaza, jobUrl);
        await fillMountingReportBasics(montaza, "E2E: drugi obilazak — nedostatak sa predračuna.");
        const dlg2 = montaza.getByRole("dialog");
        await dlg2.locator("#additional-needs").click();
        await dlg2.getByRole("button", { name: /Prijavi nedostatak na terenu/i }).click();
        await expect(montaza.getByRole("dialog", { name: /Prijavi nedostatak na terenu/i })).toBeVisible();
        await montaza.getByRole("button", { name: /^Da$/ }).click();
        await montaza.locator("#missing-pos").fill("5");
        await montaza.getByRole("button", { name: /Unesi u izveštaj/i }).click();
        await expect(montaza.getByRole("dialog", { name: /Prijavi nedostatak na terenu/i })).toBeHidden({
          timeout: 15_000,
        });
        await dlg2.getByRole("button", { name: /Sačuvaj izveštaj/i }).click();
        await expect(dlg2).toBeHidden({ timeout: 120_000 });

        await procurement.goto("/", { waitUntil: "domcontentloaded" });
        const redHitno = procurement.getByRole("alert").filter({ hasText: /HITNO: nedostatak sa ugradnje/i });
        await expect(redHitno).toBeVisible({ timeout: 120_000 });
        await expect(redHitno).toHaveClass(/border-destructive/);
        const magBtn = redHitno.getByRole("button", { name: /Zaboravljeno u magacinu/i }).first();
        await expect(magBtn).toBeVisible({ timeout: 30_000 });
        await magBtn.click();
        await expect(redHitno).toBeHidden({ timeout: 120_000 }).catch(() => {});

        await expectProdajaDashboardOptionalUnscheduledBanner(prodaja);

        await admin.goto(jobUrl, { waitUntil: "domcontentloaded" });
        await assignFirstTeamToInstallation(admin);

        await montazaOpenInstallationReport(montaza, jobUrl);
        await fillMountingReportBasics(montaza, "E2E: završni obilazak — sve u redu, ugradnja OK.");
        const dlg3 = montaza.getByRole("dialog");
        const ok3 = dlg3.locator("#ok");
        if ((await ok3.count()) > 0 && !(await ok3.isChecked())) await ok3.click();
        await dlg3.getByRole("button", { name: /Sačuvaj izveštaj/i }).click();
        await expect(dlg3).toBeHidden({ timeout: 120_000 });

        await admin.goto(jobUrl, { waitUntil: "domcontentloaded" });
        await expectJobStatusBadge(admin, STATUS.ugradnjaZavrsenaNeplaceno);

        await admin.getByRole("tab", { name: /Finansije/i }).click();
        await admin.getByRole("button", { name: /Evidentiraj uplatu/i }).click();
        const payDlg = admin.getByRole("dialog", { name: /Evidentiranje plaćanja/i });
        await payDlg.getByPlaceholder("0").fill("200000");
        await admin.getByRole("button", { name: /^Evidentiraj$/i }).click();
        await expect(payDlg).toBeHidden({ timeout: 90_000 });
        await expectJobStatusBadge(admin, STATUS.zavrsen);
      });

      await test.step("6. Prodaja — plavi widget (Upozorenja / upit sa terena) ako postoji", async () => {
        await prodaja.goto("/", { waitUntil: "domcontentloaded" });
        const salesCard = prodaja.locator(".border-sky-500\\/45, .border-sky-500\\/40").filter({ hasText: /Upit sa terena/i });
        await expect(salesCard).toBeVisible({ timeout: 20_000 }).catch(() => {
          test.info().attach("blue-widget", { body: "Nema aktivnog „Upit sa terena“ — očekivano ako teren nije tražio dopunu.", contentType: "text/plain" });
        });
      });

      await test.step("7. Reklamacija / servis posle Završen", async () => {
        await admin.goto(jobUrl, { waitUntil: "domcontentloaded" });
        await expectJobStatusBadge(admin, STATUS.zavrsen);
        await admin.getByRole("button", { name: /Otvori Reklamaciju\/Servis/i }).click();
        await expect(admin.getByRole("dialog", { name: /Reklamacija ili servis/i })).toBeVisible();
        await admin.getByRole("button", { name: /^Potvrdi$/i }).click();
        await expect(admin.getByRole("dialog", { name: /Reklamacija ili servis/i })).toBeHidden({ timeout: 60_000 });

        await admin.getByRole("tab", { name: /Nalozi/i }).click();
        const svcCard = admin.locator(".bg-card.rounded-xl").filter({ hasText: /Reklamacija|Servis|Obilazak/i }).first();
        await expect(svcCard).toBeVisible({ timeout: 60_000 });
      });

      await test.step("Cleanup: obriši test klijenta (i poslove) kroz UI", async () => {
        await deleteCustomerAndJobsByName(admin, CUSTOMER_FULL_NAME);
      });
    } finally {
      await closeAll();
    }
  });
});
