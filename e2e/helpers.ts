/**
 * E2E helperi. Polisa: podatke menjati samo kroz UI (klik/unos/brisanje kao korisnik).
 * Ne menjati aplikacionu logiku, šemu baze niti RLS iz test skripti.
 */
import { expect, type Page } from "@playwright/test";

export const SPLASH_KEY = "crm_stolarija_rich_splash_done";

/** Preskače boot splash na /login (isti ključ kao `rich-splash-session.ts`). */
export async function bypassLoginSplash(page: Page) {
  await page.addInitScript((key: string) => {
    try {
      sessionStorage.setItem(key, "1");
    } catch {
      /* private mode */
    }
  }, SPLASH_KEY);
}

export function getBaseUrl(): string | null {
  const b = process.env.PLAYWRIGHT_BASE_URL?.trim();
  return b || null;
}

export function getCredentials(): { email: string; password: string } | null {
  const email = process.env.E2E_USER_EMAIL?.trim();
  const password = process.env.E2E_USER_PASSWORD?.trim();
  if (!email || !password) return null;
  return { email, password };
}

/** Jedinstven email za registraciju (Supabase bez potvrde mejla mora da prihvati domen). */
export function buildE2eRegisterEmail(): string {
  const domain = process.env.E2E_REGISTER_EMAIL_DOMAIN?.trim() || "stolarija.rs";
  return `e2e.reg.${Date.now()}@${domain}`;
}

export async function loginWithPassword(page: Page, email: string, password: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Prijavi se" }).click();
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 45_000 });
}

export async function expectLoggedInShell(page: Page) {
  const dashboard = page.getByText("Kontrolna tabla", { exact: false }).first();
  const pendingRole = page.getByRole("heading", { name: "Uloga još nije dodeljena" });
  const pendingInactive = page.getByRole("heading", { name: "Nalog je neaktivan" });
  await expect(dashboard.or(pendingRole).or(pendingInactive)).toBeVisible({ timeout: 45_000 });
}

/** Drugi direktan child `header`-a = desna traka (tema, QR, zvono, avatar). */
export async function openUserMenu(page: Page) {
  await page.locator("header > div").nth(1).getByRole("button").last().click();
}

export async function logoutFromHeader(page: Page) {
  await openUserMenu(page);
  await page.getByRole("menuitem", { name: /Odjavi se/i }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
}
