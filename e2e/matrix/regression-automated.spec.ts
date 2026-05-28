import { test, expect } from "@playwright/test";
import {
  bypassLoginSplash,
  expectLoggedInShell,
  getBaseUrl,
  getCredentials,
  loginWithPassword,
  openUserMenu,
} from "../helpers";

test.beforeEach(async ({ page }) => {
  await bypassLoginSplash(page);
});

test.describe("A. Okruženje i omotač (automatski)", () => {
  test("A1 (sa splash preskokom) — login forma vidljiva", async ({ page }) => {
    test.skip(!getBaseUrl(), "PLAYWRIGHT_BASE_URL");
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#email")).toBeVisible({ timeout: 30_000 });
  });

  test("A4/A5 offline banner pa online", async ({ page }) => {
    test.skip(!getBaseUrl(), "PLAYWRIGHT_BASE_URL");
    const cred = getCredentials();
    test.skip(!cred, "E2E_USER_*");

    await loginWithPassword(page, cred.email, cred.password);
    await expectLoggedInShell(page);

    await page.context().setOffline(true);
    await expect(page.getByText("Nema internet veze")).toBeVisible({ timeout: 15_000 });

    await page.context().setOffline(false);
    await expect(page.getByText("Nema internet veze")).toHaveCount(0, { timeout: 15_000 });
  });

  test("A6 tema — toggle i perzistencija (localStorage)", async ({ page }) => {
    test.skip(!getBaseUrl(), "PLAYWRIGHT_BASE_URL");
    const cred = getCredentials();
    test.skip(!cred, "E2E_USER_*");

    await loginWithPassword(page, cred.email, cred.password);
    await expectLoggedInShell(page);

    const light = page.getByRole("button", { name: /Uključi svetlu temu/i });
    const dark = page.getByRole("button", { name: /Uključi tamnu temu/i });
    if (await dark.count()) await dark.first().click();
    else if (await light.count()) await light.first().click();

    const stored = await page.evaluate(() => localStorage.getItem("crm-ui-theme"));
    expect(stored === "light" || stored === "dark").toBeTruthy();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expectLoggedInShell(page);
    const afterReload = await page.evaluate(() => localStorage.getItem("crm-ui-theme"));
    expect(afterReload).toBe(stored);
  });

  test("A7 jezik u podešavanjima (admin)", async ({ page }) => {
    test.skip(!getBaseUrl(), "PLAYWRIGHT_BASE_URL");
    const cred = getCredentials();
    test.skip(!cred, "E2E_USER_*");

    await loginWithPassword(page, cred.email, cred.password);
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    const url = new URL(page.url());
    if (url.pathname === "/" || !url.pathname.includes("settings")) {
      test.skip(true, "Nalog nema pristup Podešavanjima — koristi admin.");
    }
    await expect(page.getByText(/Podešavanja|Podesavanja|Settings/i).first()).toBeVisible({ timeout: 40_000 });

    await page.getByRole("tab", { name: /Preferencije|Preferences/i }).click({ timeout: 15_000 });
  });
});

test.describe("G5 Finansije — tabovi (automatski)", () => {
  test("Pregled / Plaćanja / Izveštaji", async ({ page }) => {
    test.skip(!getBaseUrl(), "PLAYWRIGHT_BASE_URL");
    const cred = getCredentials();
    test.skip(!cred, "E2E_USER_*");

    await loginWithPassword(page, cred.email, cred.password);
    await page.goto("/finances", { waitUntil: "domcontentloaded" });
    const url = new URL(page.url());
    if (url.pathname === "/" || !url.pathname.includes("finances")) {
      test.skip(true, "Nalog nema modul finansija — koristi finance ili admin.");
    }

    await expect(page.getByRole("tab", { name: /^Finansije$/ })).toBeVisible({ timeout: 25_000 });
    await page.getByRole("tab", { name: /^Plaćanja$/ }).click();
    await expect(page.getByRole("tab", { name: /^Plaćanja$/ })).toHaveAttribute("data-state", "active");
    await page.getByRole("tab", { name: /^Izveštaji$/ }).click();
    await expect(page.getByRole("tab", { name: /^Izveštaji$/ })).toHaveAttribute("data-state", "active");
    await page.getByRole("tab", { name: /^Finansije$/ }).click();
    await expect(page.getByRole("tab", { name: /^Finansije$/ })).toHaveAttribute("data-state", "active");
  });
});

test.describe("B. Autentifikacija (dodatno)", () => {
  test("B2 from ruta — neulogiran /jobs pa prijava", async ({ page }) => {
    test.skip(!getBaseUrl(), "PLAYWRIGHT_BASE_URL");
    const cred = getCredentials();
    test.skip(!cred, "E2E_USER_*");

    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await page.locator("#email").fill(cred.email);
    await page.locator("#password").fill(cred.password);
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 45_000 });
  });

  test("B4 odjava — nema pristupa CRM posle", async ({ page }) => {
    test.skip(!getBaseUrl(), "PLAYWRIGHT_BASE_URL");
    const cred = getCredentials();
    test.skip(!cred, "E2E_USER_*");

    await loginWithPassword(page, cred.email, cred.password);
    await expectLoggedInShell(page);
    await openUserMenu(page);
    await page.getByRole("menuitem", { name: /Odjavi se/i }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });
});

test.describe("C. Kupci", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!getBaseUrl(), "PLAYWRIGHT_BASE_URL");
    const cred = getCredentials();
    test.skip(!cred, "E2E_USER_*");
    await loginWithPassword(page, cred.email, cred.password);
  });

  test("C1 novi kupac — minimalan validan unos", async ({ page }) => {
    await page.goto("/customers/new", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Novi klijent", { exact: false }).first()).toBeVisible({ timeout: 20_000 });

    const suffix = Date.now();
    await page.getByLabel("Kupac / Firma").fill(`E2E Kupac ${suffix}`);
    await page.getByLabel("Kontakt osoba").fill("E2E Kontakt");
    await page.getByLabel("Adresa za fakturisanje").fill("Bulevar 1, Novi Sad");
    await page.getByLabel("Adresa ugradnje").fill("Bulevar 1, Novi Sad");
    await page.getByPlaceholder("+381 6...").fill("0641234567");
    await page.getByPlaceholder("adresa@email.com").fill(`e2e-${suffix}@test.invalid`);

    await page.getByRole("button", { name: /Kreiraj klijenta/i }).click();
    await expect(page).toHaveURL(/\/customers/, { timeout: 30_000 });
  });

  test("C2 validacija — prazan submit", async ({ page }) => {
    await page.goto("/customers/new", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Kreiraj klijenta/i }).click();
    await expect(page.getByText("Proverite formular", { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("D. Lista poslova", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!getBaseUrl(), "PLAYWRIGHT_BASE_URL");
    const cred = getCredentials();
    test.skip(!cred, "E2E_USER_*");
    await loginWithPassword(page, cred.email, cred.password);
  });

  test("D3/D4 lista poslova — stranica i prvi link ako postoji", async ({ page }) => {
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Poslovi", { exact: false }).first()).toBeVisible({ timeout: 25_000 });

    const detalji = page.getByRole("button", { name: "Detalji" }).first();
    if (await detalji.count()) {
      await detalji.click();
      await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}/i, { timeout: 20_000 });
    }
  });

  test("D6 Novi posao — modal se otvara", async ({ page }) => {
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    const trigger = page.getByRole("button", { name: /Novi posao/i });
    if ((await trigger.count()) === 0) {
      test.skip(true, "Nalog nema create_job — koristi admin.");
    }
    await trigger.first().click();
    await expect(page.getByRole("dialog").getByText(/Novi posao|Opis posla/i).first()).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
  });
});
