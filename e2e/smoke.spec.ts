import { test, expect } from "@playwright/test";
import {
  bypassLoginSplash,
  expectLoggedInShell,
  getBaseUrl,
  getCredentials,
  loginWithPassword,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await bypassLoginSplash(page);
});

test.describe("smoke", () => {
  test("login → kontrolna tabla (ili pending)", async ({ page }) => {
    test.skip(!getBaseUrl(), "Postavi PLAYWRIGHT_BASE_URL.");
    const cred = getCredentials();
    test.skip(!cred, "Postavi E2E_USER_EMAIL i E2E_USER_PASSWORD.");

    await loginWithPassword(page, cred.email, cred.password);
    await expectLoggedInShell(page);
  });
});
