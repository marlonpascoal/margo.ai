// Owner portal sign-in for e2e without the P15 page: the same /api/auth/code and /api/auth/verify calls
// P15 makes (04 §8), with the code read from Mailpit. The session cookies land in the page's context.
import { expect, type Page } from "@playwright/test";
import { clearMail, mailCode, waitForResendWindow } from "./helpers";

export async function portalSession(page: Page, email: string) {
  await waitForResendWindow(email);
  await clearMail(email);
  const sent = await page.request.post("/api/auth/code", { data: { email, surface: "portal" } });
  expect(sent.ok(), "code sent").toBe(true);
  const code = await mailCode(email);
  expect(code, "code e-mail in Mailpit").not.toBeNull();
  const ok = await page.request.post("/api/auth/verify", { data: { email, code, surface: "portal" } });
  expect(ok.ok(), "code accepted").toBe(true);
}
