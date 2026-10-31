// F02 for P04: the built popup at the drawn size (380 x 560) on the Partner Portal tab, with the seeded
// Pantanos token and the real local status endpoint. The real extension calls our API under its host
// permission; a plain page has CORS, so this browser runs without web security.
import path from "node:path";
import { expect, test } from "@playwright/test";
import { buildExtension, chromeStub, PORTAL_TAB } from "./extension-helpers";
import { ARTIFACTS } from "./helpers";

test.use({ launchOptions: { args: ["--disable-web-security"] }, viewport: { width: 380, height: 560 } });

test("F02_P04_popup", async ({ page, baseURL }) => {
  await page.addInitScript(chromeStub(PORTAL_TAB, "g-syn-extensao-pantanos"));
  await page.goto(buildExtension(baseURL!, path.join(ARTIFACTS, "extension-screens")));
  await expect(page.locator("footer")).toHaveText("último envio: 28/out 21:14 · dados fictícios");
  await page.screenshot({ path: path.join(ARTIFACTS, "screens", "P04-Extensao-380.png"), caret: "initial" });
});
