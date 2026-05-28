import { test, expect } from "@playwright/test";
import { bypassLoginSplash, getBaseUrl } from "./helpers";

test.beforeEach(async ({ page }) => {
  await bypassLoginSplash(page);
});

test.describe("bez prijave", () => {
  test("zaštićena ruta /jobs vodi na /login", async ({ page }) => {
    test.skip(!getBaseUrl(), "PLAYWRIGHT_BASE_URL");
    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  });

  test("404 — stranica nije pronađena", async ({ page }) => {
    test.skip(!getBaseUrl(), "PLAYWRIGHT_BASE_URL");
    await page.goto("/e2e-unknown-route-not-found", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText("Stranica nije pronađena")).toBeVisible();
  });

  test("A8 /random — NotFound", async ({ page }) => {
    test.skip(!getBaseUrl(), "PLAYWRIGHT_BASE_URL");
    await page.goto("/random", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText("Stranica nije pronađena")).toBeVisible({ timeout: 15_000 });
  });

  test("javna narudžbenica — neispravan token (nije UUID)", async ({ page }) => {
    test.skip(!getBaseUrl(), "PLAYWRIGHT_BASE_URL");
    await page.goto("/narudzbenica/nije-validan-uuid", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Neispravan link za narudžbenicu.")).toBeVisible({ timeout: 20_000 });
  });

  test("/login se učitava", async ({ page }) => {
    test.skip(!getBaseUrl(), "PLAYWRIGHT_BASE_URL");
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Prijavi se" })).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
  });
});
