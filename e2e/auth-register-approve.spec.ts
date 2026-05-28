import { test, expect } from "@playwright/test";
import {
  bypassLoginSplash,
  buildE2eRegisterEmail,
  expectLoggedInShell,
  getBaseUrl,
  getCredentials,
  loginWithPassword,
} from "./helpers";

/** Uloga sa širokim pristupom za smoke posle odobrenja (`ROLE_CONFIG.office.label`). */
const APPROVE_ROLE_MENU = /Kancelarija\s*\/\s*Prodaja/;

test.describe.configure({ mode: "serial" });

test.describe("registracija i odobrenje uloge", () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test("novi nalog → čeka odobrenje → admin dodeli ulogu → kontrolna tabla", async ({ browser }) => {
    test.skip(!getBaseUrl(), "PLAYWRIGHT_BASE_URL");
    const admin = getCredentials();
    test.skip(!admin, "E2E_USER_EMAIL / E2E_USER_PASSWORD (admin sa /users)");

    const newEmail = buildE2eRegisterEmail();
    const newPassword =
      process.env.E2E_REGISTER_PASSWORD?.trim() || "E2eRegTest99!";
    const fullName = `E2E registracija ${Date.now()}`;

    const userContext = await browser.newContext();
    const adminContext = await browser.newContext();
    const userPage = await userContext.newPage();
    const adminPage = await adminContext.newPage();
    await bypassLoginSplash(userPage);
    await bypassLoginSplash(adminPage);

    let cleanupEmail: string | null = null;

    try {
      await userPage.goto("/login", { waitUntil: "domcontentloaded" });
      await userPage.getByRole("button", { name: "Registrujte se" }).click();
      await userPage.getByLabel("Ime i prezime").fill(fullName);
      await userPage.locator("#email").fill(newEmail);
      await userPage.locator("#password").fill(newPassword);
      await userPage.getByRole("button", { name: "Registruj se" }).click();

      await expect(userPage).toHaveURL(/\/pending-approval/, { timeout: 60_000 });
      await expect(
        userPage.getByRole("heading", { name: "Uloga još nije dodeljena" }),
      ).toBeVisible({ timeout: 15_000 });

      cleanupEmail = newEmail;

      await loginWithPassword(adminPage, admin.email, admin.password);
      await expectLoggedInShell(adminPage);

      await adminPage.goto("/users", { waitUntil: "domcontentloaded" });
      await expect(adminPage.getByRole("heading", { name: "Korisnici i uloge" })).toBeVisible({
        timeout: 30_000,
      });

      const row = adminPage.locator("tr").filter({ hasText: newEmail });
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(row.getByText("Čeka odobrenje", { exact: false })).toBeVisible();

      await row.locator("td").last().getByRole("button").click();
      await adminPage.getByRole("menuitem", { name: APPROVE_ROLE_MENU }).click();
      await expect(row.getByText("Kancelarija", { exact: false })).toBeVisible({ timeout: 20_000 });

      await userPage.reload({ waitUntil: "domcontentloaded" });
      await expect(userPage).not.toHaveURL(/\/pending-approval/, { timeout: 45_000 });
      await expect(userPage.getByText("Kontrolna tabla", { exact: false }).first()).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      if (cleanupEmail) {
        try {
          await adminPage.goto("/login", { waitUntil: "domcontentloaded" });
          await loginWithPassword(adminPage, admin.email, admin.password);
          await adminPage.goto("/users", { waitUntil: "domcontentloaded" });
          const row = adminPage.locator("tr").filter({ hasText: cleanupEmail });
          if ((await row.count()) > 0) {
            await row.locator("td").last().getByRole("button").click();
            await adminPage.getByRole("menuitem", { name: /Obriši nalog/ }).click();
            const dialog = adminPage.getByRole("alertdialog");
            await expect(dialog).toBeVisible({ timeout: 10_000 });
            await dialog.getByRole("button", { name: /^Obriši$/ }).click();
            await expect(dialog).toBeHidden({ timeout: 20_000 });
          }
        } catch {
          /* čišćenje je best-effort (npr. admin_delete_user nije na bazi) */
        }
      }
      await userContext.close();
      await adminContext.close();
    }
  });
});
