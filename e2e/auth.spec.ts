import { test, expect } from "@playwright/test";
import {
  bypassLoginSplash,
  expectLoggedInShell,
  getBaseUrl,
  getCredentials,
  loginWithPassword,
  logoutFromHeader,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await bypassLoginSplash(page);
});

test.describe("autentifikacija", () => {
  test("pogrešna lozinka ostaje na /login", async ({ page }) => {
    test.skip(!getBaseUrl(), "PLAYWRIGHT_BASE_URL");
    const cred = getCredentials();
    test.skip(!cred, "E2E_USER_EMAIL / E2E_USER_PASSWORD");

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.locator("#email").fill(cred.email);
    await page.locator("#password").fill(`${cred.password}_NEVALJA`);
    await page.getByRole("button", { name: "Prijavi se" }).click();

    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await expect(page.locator("#email")).toBeVisible();
  });

  test("prazan submit — ostaje na login formi", async ({ page }) => {
    test.skip(!getBaseUrl(), "PLAYWRIGHT_BASE_URL");

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Prijavi se" }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("#email")).toBeVisible();
  });

  test.describe("sesija", () => {
    test("login pa odjava", async ({ page }) => {
      test.skip(!getBaseUrl(), "PLAYWRIGHT_BASE_URL");
      const cred = getCredentials();
      test.skip(!cred, "E2E_USER_EMAIL / E2E_USER_PASSWORD");

      await loginWithPassword(page, cred.email, cred.password);
      await expectLoggedInShell(page);

      await logoutFromHeader(page);
      await expect(page.locator("#email")).toBeVisible();
    });
  });
});
