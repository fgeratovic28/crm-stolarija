/**
 * Isti životni ciklus kao u `full-client-cycle.test.ts`, podeljen u serijske faze (posebni `test()` blokovi).
 * Monolit se ne menja; zajednička logika je u `full-client-cycle-shared.ts`.
 *
 * Uloge u `.env.playwright` (istorijska imena → CRM): `DISPATCHER_*` = prodaja, `MONTAZNIK_*` = montaža,
 * `MAGACIN_*` = proizvodnja (prijem porudžbine).
 *
 * Pokretanje: `npm run test:e2e:full-cycle:phases` (projekat `full-cycle-phases`).
 */
import { test, expect } from "@playwright/test";
import type { Browser, Page, BrowserContext } from "@playwright/test";
import {
  baseUrl,
  pickCreds,
  login,
  expectJobStatusBadge,
  minimalPdfAsFile,
  cutListCsv,
  deleteCustomerAndJobsByName,
  simulateUsbBarcode,
  extractProcurementBarcodeFromReception,
  fillMaterialOrderAndSend,
  assignFirstTeamToInstallation,
  pickFirstTeamInInstallationScheduleDialog,
  montazaOpenInstallationReport,
  fillMountingReportBasics,
  expectProdajaDashboardOptionalUnscheduledBanner,
  JOB_SUMMARY,
  CUSTOMER_FULL_NAME,
  STATUS,
} from "./full-client-cycle-shared";

test.describe.configure({ mode: "serial" });

test.describe("Full client lifecycle (faze) @full-cycle @full-cycle-phases", () => {
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

  let admin: Page | undefined;
  let prodaja: Page | undefined;
  let montaza: Page | undefined;
  let proizvodnja: Page | undefined;
  let procurement: Page | undefined;
  let jobUrl = "";
  let materialOrderId: string | null = null;

  test.afterAll(async () => {
    try {
      if (admin) await deleteCustomerAndJobsByName(admin, CUSTOMER_FULL_NAME);
    } catch {
      /* ignore */
    }
    await closeAll();
  });

  test("Faza 1 — Priprema + novi kupac + upit", async ({ browser }) => {
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

    admin = await mk(browser, adminC);
    prodaja = await mk(browser, prodajaC);
    montaza = await mk(browser, montazaC);
    proizvodnja = await mk(browser, proizvodnjaC);
    procurement = await mk(browser, procC);

    await deleteCustomerAndJobsByName(admin, CUSTOMER_FULL_NAME);

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

  test("Faza 2 — Ponuda → prihvat → merenje → izveštaj (Sve u redu)", async () => {
    test.skip(!admin || !prodaja || !montaza || !jobUrl, "Faza 1 nije prošla ili nema sesija.");

    await admin!.getByRole("tab", { name: /Ponude/i }).click();

    await admin!.getByRole("button", { name: /Nova ponuda/i }).click();
    const v1 = `E2E v1 ${Date.now()}`;
    await admin!.getByLabel(/Naziv verzije|verzij/i).fill(v1);
    await admin!.locator('input[type="file"]').first().setInputFiles(minimalPdfAsFile());
    await admin!.getByRole("button", { name: /Sačuvaj ponudu/i }).click();
    await expect(admin!.getByRole("dialog", { name: /Nova ponuda/i })).toBeHidden({ timeout: 120_000 });

    const row1 = admin!.locator("table tbody tr").filter({ hasText: v1 });
    await row1.locator('[role="combobox"]').first().click();
    await admin!.getByRole("option", { name: "Poslata" }).click();
    await expectJobStatusBadge(admin!, STATUS.ponudaPoslata);

    await admin!.getByRole("button", { name: /Označi kao prihvaćenu/i }).first().click();
    await expect(admin!.getByRole("dialog", { name: /Potvrdite konačnu cenu/i })).toBeVisible();
    await admin!.locator("#accept-final-price").fill("120000");
    await admin!.getByRole("button", { name: "Potvrdi prihvatanje" }).click();
    await expect(admin!.getByRole("dialog", { name: /Potvrdite konačnu cenu/i })).toBeHidden({ timeout: 120_000 });
    await expectJobStatusBadge(admin!, STATUS.prihvaceno);

    await admin!.getByRole("tab", { name: /Pregled/i }).click();
    await admin!.getByRole("button", { name: /Zakaži merenje/i }).click();
    const measureDlg = admin!.getByRole("dialog", { name: /Zakaži merenje/i });
    await expect(measureDlg).toBeVisible();

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isoLocal = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}T10:00`;
    await measureDlg.locator("#measurement-datetime").fill(isoLocal);

    const teamTrigger = measureDlg.getByRole("combobox");
    await expect(teamTrigger).toBeEnabled({ timeout: 60_000 });
    await teamTrigger.click();
    const teamOption = admin!.locator('[role="listbox"]').getByRole("option").first();
    await expect(teamOption).toBeVisible({ timeout: 60_000 });
    await teamOption.click({ timeout: 30_000 });
    await admin!.getByRole("button", { name: /Sačuvaj i zakaži/i }).click();
    await expect(admin!.getByRole("dialog", { name: /Zakaži merenje/i })).toBeHidden({ timeout: 120_000 });
    await expectJobStatusBadge(admin!, STATUS.merenje);

    await expectProdajaDashboardOptionalUnscheduledBanner(prodaja!);

    await montaza!.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await montaza!.getByRole("tab", { name: /Nalozi/i }).click();
    const pokreni = montaza!.getByRole("button", { name: /^Pokreni$/ }).first();
    if (await pokreni.isVisible()) await pokreni.click();
    await montaza!.getByRole("button", { name: /Dodaj izveštaj/i }).first().click();
    await expect(montaza!.getByRole("dialog")).toBeVisible({ timeout: 30_000 });

    const okSwitch = montaza!.locator("#ok");
    if ((await okSwitch.count()) > 0 && !(await okSwitch.isChecked())) await okSwitch.click();

    await montaza!.getByRole("dialog").getByPlaceholder(/Dodatni opis ili mere/i).fill("1000×1200 mm");
    await montaza!.getByRole("dialog").getByPlaceholder("npr. 4").fill("4");
    await montaza!.getByRole("button", { name: /Sačuvaj izveštaj/i }).click();
    await expect(montaza!.getByRole("dialog")).toBeHidden({ timeout: 120_000 });

    await admin!.reload({ waitUntil: "domcontentloaded" });
    await expectJobStatusBadge(admin!, STATUS.obradaMera);
  });

  test("Faza 3 — Finalna ponuda → uplata → krojna lista → materijal (Čeka materijal)", async () => {
    test.skip(!admin || !procurement || !jobUrl, "Faza 1 nije prošla ili nema sesija.");

    await admin!.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await admin!.getByRole("tab", { name: /Ponude/i }).click();
    await admin!.getByRole("button", { name: /Nova ponuda/i }).click();
    const vf = `E2E final ${Date.now()}`;
    await admin!.getByLabel(/Naziv verzije|verzij/i).fill(vf);
    await admin!.locator('input[type="file"]').first().setInputFiles(minimalPdfAsFile());
    await admin!.getByRole("checkbox", { name: /dopun|addon|merenj/i }).click().catch(() => {});
    await admin!.getByRole("button", { name: /Sačuvaj ponudu/i }).click();
    await expect(admin!.getByRole("dialog", { name: /Nova ponuda/i })).toBeHidden({ timeout: 120_000 });

    const rowF = admin!.locator("table tbody tr").filter({ hasText: vf });
    await rowF.locator('[role="combobox"]').first().click();
    await admin!.getByRole("option", { name: "Poslata" }).click();
    await expectJobStatusBadge(admin!, STATUS.finalnaPoslata);

    await admin!.getByRole("button", { name: /Označi kao prihvaćenu/i }).first().click();
    await expect(admin!.getByRole("dialog", { name: /Potvrdite konačnu cenu/i })).toBeVisible();
    await admin!.locator("#accept-final-price").fill("150000");
    await admin!.getByRole("button", { name: "Potvrdi prihvatanje" }).click();
    await expect(admin!.getByRole("dialog", { name: /Potvrdite konačnu cenu/i })).toBeHidden({ timeout: 120_000 });
    await expectJobStatusBadge(admin!, STATUS.finalnaCekaUplatu);

    await admin!.getByRole("tab", { name: /Finansije/i }).click();
    await admin!.getByRole("button", { name: /Evidentiraj uplatu/i }).click();
    await admin!.getByRole("dialog", { name: /Evidentiranje plaćanja/i }).getByPlaceholder("0").fill("50000");
    await admin!.getByRole("button", { name: /^Evidentiraj$/i }).click();
    await expect(admin!.getByRole("dialog", { name: /Evidentiranje plaćanja/i })).toBeHidden({ timeout: 60_000 });
    await expectJobStatusBadge(admin!, STATUS.spremnoZaRad);

    await admin!.getByRole("tab", { name: /Krojna lista/i }).click();
    await admin!.locator("#cutlist-upload").setInputFiles(cutListCsv());
    await expect(admin!.getByText(/stavk/i)).toBeVisible({ timeout: 60_000 }).catch(() => {});

    await admin!.getByRole("tab", { name: /Materijal/i }).click();
    await fillMaterialOrderAndSend(admin!);

    await expectJobStatusBadge(admin!, STATUS.cekaMaterijal);
    const amberBadge = admin!.locator("span.rounded-full").filter({ hasText: STATUS.cekaMaterijal }).first();
    await expect(amberBadge).toHaveClass(/amber/);

    await procurement!.goto("/", { waitUntil: "domcontentloaded" });
    const amberBlock = procurement!.locator(".border-amber-500\\/55, .border-amber-500\\/45").first();
    await expect(amberBlock.or(procurement!.getByText(/Narudžbine na čekanju|Čeka se isporuku|kašnjenja/i))).toBeVisible({
      timeout: 45_000,
    }).catch(() => {
      test.info().attach("procurement-orange-note", {
        body: "Nije pronađen istaknut narandžasti blok — staging statistika možda nema kašnjenja.",
        contentType: "text/plain",
      });
    });

    await admin!.getByRole("tab", { name: /Krojna lista/i }).click();
    const linkPrijem = admin!.getByRole("link", { name: /Prijem \(barkod\)|Otvori prijem/i }).first();
    await expect(linkPrijem).toBeVisible({ timeout: 60_000 });
    const href = await linkPrijem.getAttribute("href");
    const m = href?.match(/\/order-reception\/([0-9a-f-]{36})/i);
    materialOrderId = m?.[1] ?? null;
  });

  test("Faza 4 — Proizvodnja: prijem porudžbine → U proizvodnji → proizvodnja završena → Čeka ugradnju", async () => {
    test.skip(!admin || !prodaja || !proizvodnja || !jobUrl, "Prethodne faze nisu prošle.");
    test.skip(!materialOrderId, "Nije izvučen ID narudžbine za prijem.");

    await proizvodnja!.goto(`/order-reception/${materialOrderId}`, { waitUntil: "domcontentloaded" });
    const code = await extractProcurementBarcodeFromReception(proizvodnja!);
    await simulateUsbBarcode(proizvodnja!, code);
    await expect(proizvodnja!.getByText(/Rešeno|Primljeno|Uspešno/i).first()).toBeVisible({ timeout: 60_000 }).catch(() => {});
    const finishBtn = proizvodnja!.getByRole("button", { name: /Završi prijem porudžbine/i });
    if (await finishBtn.isVisible()) await finishBtn.click();
    await expect(proizvodnja!.getByText(/primljen|završen/i).first()).toBeVisible({ timeout: 120_000 }).catch(() => {});

    await admin!.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await expectJobStatusBadge(admin!, STATUS.uProizvodnji);

    await admin!.getByRole("button", { name: /Da, proizvodnja je završena/i }).click();
    await expectJobStatusBadge(admin!, STATUS.cekaUgradnju);

    await expectProdajaDashboardOptionalUnscheduledBanner(prodaja!);
  });

  test("Faza 5 — Ugradnja: otkaz → problem; nedostatak → HITNO; uspeh → Završen", async () => {
    test.skip(!admin || !prodaja || !montaza || !procurement || !jobUrl, "Prethodne faze nisu prošle.");

    await admin!.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await admin!.getByRole("button", { name: /Zakaži ugradnju|Ponovo zakazite ugradnju/i }).click();
    await expect(admin!.getByRole("dialog", { name: /Zakaži ugradnju|Ponovo zakazite ugradnju/i })).toBeVisible({
      timeout: 30_000,
    });
    const inst = new Date();
    inst.setDate(inst.getDate() + 2);
    const instIso = `${inst.getFullYear()}-${String(inst.getMonth() + 1).padStart(2, "0")}-${String(inst.getDate()).padStart(2, "0")}T14:00`;
    await admin!.locator("#installation-datetime").fill(instIso);
    await pickFirstTeamInInstallationScheduleDialog(admin!);
    await admin!.getByRole("button", { name: /Sačuvaj i zakaži/i }).click();
    await expect(admin!.getByRole("dialog", { name: /Zakaži ugradnju|Ponovo zakazite ugradnju/i })).toBeHidden({
      timeout: 60_000,
    });

    await montazaOpenInstallationReport(montaza!, jobUrl);
    await fillMountingReportBasics(montaza!, "E2E: prvi obilazak — otkaz na lokaciji.");
    const dlg = montaza!.getByRole("dialog");
    await dlg.locator("#canceled").click();
    await dlg.getByPlaceholder("Razlog").fill("Otkazano na lokaciji — klijent odbio termin E2E");
    await dlg.getByRole("button", { name: /Sačuvaj izveštaj/i }).click();
    await expect(dlg).toBeHidden({ timeout: 120_000 });

    await admin!.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await expectJobStatusBadge(admin!, STATUS.ugradnjaProblem);

    await admin!.getByRole("button", { name: /Ponovo zakazite ugradnju/i }).click();
    await expect(admin!.getByRole("dialog", { name: /Ponovo zakazite ugradnju/i })).toBeVisible({ timeout: 30_000 });
    const inst2 = new Date();
    inst2.setDate(inst2.getDate() + 3);
    const inst2Iso = `${inst2.getFullYear()}-${String(inst2.getMonth() + 1).padStart(2, "0")}-${String(inst2.getDate()).padStart(2, "0")}T09:30`;
    await admin!.locator("#installation-datetime").fill(inst2Iso);
    await pickFirstTeamInInstallationScheduleDialog(admin!);
    await admin!.getByRole("button", { name: /Sačuvaj i zakaži/i }).click();
    await expect(admin!.getByRole("dialog")).toBeHidden({ timeout: 60_000 });

    await montazaOpenInstallationReport(montaza!, jobUrl);
    await fillMountingReportBasics(montaza!, "E2E: drugi obilazak — nedostatak sa predračuna.");
    const dlg2 = montaza!.getByRole("dialog");
    await dlg2.locator("#additional-needs").click();
    await dlg2.getByRole("button", { name: /Prijavi nedostatak na terenu/i }).click();
    await expect(montaza!.getByRole("dialog", { name: /Prijavi nedostatak na terenu/i })).toBeVisible();
    await montaza!.getByRole("button", { name: /^Da$/ }).click();
    await montaza!.locator("#missing-pos").fill("5");
    await montaza!.getByRole("button", { name: /Unesi u izveštaj/i }).click();
    await expect(montaza!.getByRole("dialog", { name: /Prijavi nedostatak na terenu/i })).toBeHidden({
      timeout: 15_000,
    });
    await dlg2.getByRole("button", { name: /Sačuvaj izveštaj/i }).click();
    await expect(dlg2).toBeHidden({ timeout: 120_000 });

    await procurement!.goto("/", { waitUntil: "domcontentloaded" });
    const redHitno = procurement!.getByRole("alert").filter({ hasText: /HITNO: nedostatak sa ugradnje/i });
    await expect(redHitno).toBeVisible({ timeout: 120_000 });
    await expect(redHitno).toHaveClass(/border-destructive/);
    const magBtn = redHitno.getByRole("button", { name: /Zaboravljeno u magacinu/i }).first();
    await expect(magBtn).toBeVisible({ timeout: 30_000 });
    await magBtn.click();
    await expect(redHitno).toBeHidden({ timeout: 120_000 }).catch(() => {});

    await expectProdajaDashboardOptionalUnscheduledBanner(prodaja!);

    await admin!.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await assignFirstTeamToInstallation(admin!);

    await montazaOpenInstallationReport(montaza!, jobUrl);
    await fillMountingReportBasics(montaza!, "E2E: završni obilazak — sve u redu, ugradnja OK.");
    const dlg3 = montaza!.getByRole("dialog");
    const ok3 = dlg3.locator("#ok");
    if ((await ok3.count()) > 0 && !(await ok3.isChecked())) await ok3.click();
    await dlg3.getByRole("button", { name: /Sačuvaj izveštaj/i }).click();
    await expect(dlg3).toBeHidden({ timeout: 120_000 });

    await admin!.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await expectJobStatusBadge(admin!, STATUS.ugradnjaZavrsenaNeplaceno);

    await admin!.getByRole("tab", { name: /Finansije/i }).click();
    await admin!.getByRole("button", { name: /Evidentiraj uplatu/i }).click();
    const payDlg = admin!.getByRole("dialog", { name: /Evidentiranje plaćanja/i });
    await payDlg.getByPlaceholder("0").fill("200000");
    await admin!.getByRole("button", { name: /^Evidentiraj$/i }).click();
    await expect(payDlg).toBeHidden({ timeout: 90_000 });
    await expectJobStatusBadge(admin!, STATUS.zavrsen);
  });

  test("Faza 6 — Prodaja (plavi widget) + reklamacija/servis", async () => {
    test.skip(!admin || !prodaja || !jobUrl, "Prethodne faze nisu prošle.");

    await prodaja!.goto("/", { waitUntil: "domcontentloaded" });
    const salesCard = prodaja!.locator(".border-sky-500\\/45, .border-sky-500\\/40").filter({ hasText: /Upit sa terena/i });
    await expect(salesCard).toBeVisible({ timeout: 20_000 }).catch(() => {
      test.info().attach("blue-widget", {
        body: "Nema aktivnog „Upit sa terena“ — očekivano ako teren nije tražio dopunu.",
        contentType: "text/plain",
      });
    });

    await admin!.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await expectJobStatusBadge(admin!, STATUS.zavrsen);
    await admin!.getByRole("button", { name: /Otvori Reklamaciju\/Servis/i }).click();
    await expect(admin!.getByRole("dialog", { name: /Reklamacija ili servis/i })).toBeVisible();
    await admin!.getByRole("button", { name: /^Potvrdi$/i }).click();
    await expect(admin!.getByRole("dialog", { name: /Reklamacija ili servis/i })).toBeHidden({ timeout: 60_000 });

    await admin!.getByRole("tab", { name: /Nalozi/i }).click();
    const svcCard = admin!.locator(".bg-card.rounded-xl").filter({ hasText: /Reklamacija|Servis|Obilazak/i }).first();
    await expect(svcCard).toBeVisible({ timeout: 60_000 });
  });
});
