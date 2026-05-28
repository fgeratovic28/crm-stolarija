import { test, expect } from "@playwright/test";
import { getBaseUrl } from "./helpers";

/**
 * Namerno bez `bypassLoginSplash` — simulacija prvog cold učitavanja /login.
 * Pokriva matricu **A1** (spinner / forma, nema „praznog” ekrana u smislu potpuno praznog body-ja).
 */
test.describe("A1 cold load", () => {
  test("spinner ili forma prijave, body sa sadržajem", async ({ page }) => {
    test.skip(!getBaseUrl(), "PLAYWRIGHT_BASE_URL");
    await page.goto("/login", { waitUntil: "domcontentloaded", timeout: 60_000 });

    const textLen = await page.evaluate(() => (document.body?.innerText || "").trim().length);
    expect(textLen).toBeGreaterThan(10);

    await expect(page.locator("#email").or(page.getByRole("progressbar"))).toBeVisible({
      timeout: 60_000,
    });
  });
});
