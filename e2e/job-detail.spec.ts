import { test, expect } from "@playwright/test";
import {
  bypassLoginSplash,
  getBaseUrl,
  getCredentials,
  loginWithPassword,
} from "./helpers";

/**
 * Postavi `E2E_JOB_ID` (UUID posla na stagingu) da prođe tabovi na detalju.
 * Bez toga test se preskače — ne pravi nov posao u bazi iz E2E.
 */
const JOB_ID = process.env.E2E_JOB_ID?.trim();

test.beforeEach(async ({ page }) => {
  await bypassLoginSplash(page);
});

test.describe("detalj posla", () => {
  test("pregled + tabovi (sa E2E_JOB_ID)", async ({ page }) => {
    test.skip(!getBaseUrl(), "PLAYWRIGHT_BASE_URL");
    test.skip(!JOB_ID, "Postavi E2E_JOB_ID (UUID posla na stagingu).");
    const cred = getCredentials();
    test.skip(!cred, "E2E_USER_EMAIL / E2E_USER_PASSWORD");

    await loginWithPassword(page, cred.email, cred.password);
    await page.goto(`/jobs/${JOB_ID}`, { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });

    // Pregled je uvek prisutan na detalju
    await expect(page.getByRole("tab", { name: /Pregled/i })).toBeVisible({ timeout: 20_000 });

    const tabNames = [
      /Aktivnosti/i,
      /Finansije/i,
      /Ponude/i,
      /Krojna lista|krojna/i,
      /Materijal/i,
      /Nalozi/i,
      /Teren/i,
      /Fajlovi/i,
    ];
    for (const name of tabNames) {
      const tab = page.getByRole("tab", { name });
      if ((await tab.count()) > 0) {
        await tab.first().click();
        await expect(tab.first()).toHaveAttribute("data-state", "active", { timeout: 10_000 });
      }
    }
  });
});
