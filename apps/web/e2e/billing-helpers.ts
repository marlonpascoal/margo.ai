// Portal login for the billing e2e and screenshots. P15 (/entrar) belongs to the portal lane, so this logs
// in through the same API routes it calls, with the code from Mailpit.
import { expect, type Page } from "@playwright/test";
import { clearMail, mailCode, waitForResendWindow } from "./helpers";

export async function loginToPortal(page: Page, email: string) {
  await waitForResendWindow(email);
  await clearMail(email);
  expect((await page.request.post("/api/auth/code", { data: { email, surface: "portal" } })).ok()).toBe(true);
  const code = await mailCode(email);
  expect(code, "code e-mail in Mailpit").not.toBeNull();
  expect((await page.request.post("/api/auth/verify", { data: { email, code, surface: "portal" } })).ok()).toBe(true);
}
