import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

// Učitaj `.env.playwright` iz korena repoa (ne pregazi varijable već postavljene u terminalu ili CI).
loadDotenv({ path: path.resolve(process.cwd(), ".env.playwright") });

/**
 * E2E protiv već deployovanog fronta (npr. Vercel staging).
 * Build na tom URL-u već sadrži VITE_SUPABASE_* — test samo vozi browser; nema migracija u ovom toku.
 *
 * Polisa podataka (staging):
 * — Dozvoljeno: klik, unos, brisanje i izmene podataka kroz UI (ono što korisnik može).
 * — Nije dozvoljeno iz E2E / za ovaj tok: menjanje funkcionalnosti aplikacije, šeme/strukture baze
 *   i RLS politika (migracije, SQL u konzoli, bypass auth-a, direktan pristup bazi radi obilaženja pravila).
 *
 * Priprema:
 * 1) Kopiraj `.env.playwright.example` → `.env.playwright` i popuni vrednosti.
 * 2) Jednom: `npx playwright install chromium`
 * 3) `npm run test:e2e:headed` (vidljiv browser) ili `npm run test:e2e` / `npm run test:e2e:ui`
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL?.trim() || "";

const slowMs = Number(process.env.PLAYWRIGHT_SLOW_MS || "0");
const launchOptions =
  Number.isFinite(slowMs) && slowMs > 0 ? { slowMo: slowMs } : undefined;

if (process.env.CI && !baseURL) {
  throw new Error("U CI obavezno postavi secret PLAYWRIGHT_BASE_URL (pun URL deployovanog fronta).");
}

export default defineConfig({
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    ...(baseURL ? { baseURL } : {}),
    ...(launchOptions ? { launchOptions } : {}),
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
  projects: [
    { name: "chromium", testDir: "e2e", use: { ...devices["Desktop Chrome"] } },
    {
      name: "full-cycle",
      testDir: "tests",
      use: { ...devices["Desktop Chrome"], actionTimeout: 45_000 },
      testMatch: "**/full-client-cycle.test.ts",
      timeout: 900_000,
      expect: { timeout: 25_000 },
    },
    {
      name: "full-cycle-phases",
      testDir: "tests",
      use: { ...devices["Desktop Chrome"], actionTimeout: 45_000 },
      testMatch: "**/full-client-cycle-phases.test.ts",
      timeout: 900_000,
      expect: { timeout: 25_000 },
    },
  ],
});
