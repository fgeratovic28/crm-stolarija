import { test, expect } from "@playwright/test";
import {
  bypassLoginSplash,
  getBaseUrl,
  getCredentials,
  loginWithPassword,
} from "./helpers";

/**
 * Za svaku rutu: ako uloga nema modul, `ProtectedRoute` šalje na `/`.
 * Test prolazi ako smo autentifikovani i (vidljiv očekivani sadržaj ILI redirect na početnu).
 */
const ROUTES: { path: string; mustSee: RegExp }[] = [
  { path: "/", mustSee: /Kontrolna tabla/ },
  { path: "/jobs", mustSee: /Poslovi|Jobs/ },
  { path: "/customers", mustSee: /Kupci|Poslovi|Customers|Jobs/ },
  { path: "/activities", mustSee: /Aktivnosti|Activities/ },
  { path: "/finances", mustSee: /Finans|Finance|Plaćanja|Payments|Pregled|Overview/ },
  { path: "/material-orders", mustSee: /Narudžbin|Material|Porudžb/ },
  { path: "/material-reception", mustSee: /Prijem|Reception|materijal/ },
  { path: "/suppliers", mustSee: /Dobavljač|Supplier/ },
  { path: "/vehicles", mustSee: /Vozil|Vehicle/ },
  { path: "/workers", mustSee: /Radnic|Worker/ },
  { path: "/work-orders", mustSee: /Radni nalozi|Radni nalog|Work order/i },
  { path: "/field-reports", mustSee: /Terenski|Field report/ },
  { path: "/files", mustSee: /Fajlov|Dokument|Files/ },
  { path: "/teams", mustSee: /Tim|Teams|Terenski tim/ },
  { path: "/users", mustSee: /Korisnic|Users|Uloge|Roles/ },
  { path: "/settings", mustSee: /Podešavanja|Settings|Firma|Company/ },
  { path: "/profile", mustSee: /Moj profil|Profil|Profile/i },
  { path: "/jobs-map", mustSee: /Mapa|map|Završen|Completed/ },
];

test.beforeEach(async ({ page }) => {
  await bypassLoginSplash(page);
});

test.describe("moduli (nakon prijave)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!getBaseUrl(), "PLAYWRIGHT_BASE_URL");
    const cred = getCredentials();
    test.skip(!cred, "E2E_USER_EMAIL / E2E_USER_PASSWORD");
    await loginWithPassword(page, cred.email, cred.password);
  });

  for (const { path, mustSee } of ROUTES) {
    test(`GET ${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page).not.toHaveURL(/\/login$/, { timeout: 20_000 });

      const url = new URL(page.url());
      const onHome = url.pathname === "/" || url.pathname === "";

      if (path !== "/" && onHome) {
        // Nema prava na modul — očekivan redirect na početnu
        await expect(page.getByText("Kontrolna tabla", { exact: false }).first()).toBeVisible({
          timeout: 15_000,
        });
        return;
      }

      await expect(page.getByText(mustSee).first()).toBeVisible({ timeout: 25_000 });
    });
  }
});
