// F02 for module 3 intake: C10 and C11 at 390 px and 1280 px on the seeded G-02, plus the P05 text C10
// opens (a WhatsApp template, saved as text next to the screenshots for Marlon to compare with the drawing).
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { ARTIFACTS, FOUNDER_EMAIL, loginToConsole } from "./helpers";

const OUT = path.join(ARTIFACTS, "screens");
const WIDTHS = [390, 1280];
const SCREENS: [file: string, url: string][] = [
  ["C10-Notas", "/console/contas/G-02/notas"],
  ["C11-Depara", "/console/contas/G-02/de-para"],
];

test("F02_C10_C11_P05_as_founder", async ({ page }) => {
  await loginToConsole(page, FOUNDER_EMAIL);
  for (const [file, url] of SCREENS) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      await page.screenshot({ path: path.join(OUT, `${file}-${width}.png`), fullPage: true, caret: "initial" });
    }
  }
  await page.goto("/console/contas/G-02/notas");
  const href = await page.getByRole("link", { name: "Pedir nota pelo WhatsApp" }).getAttribute("href");
  const text = new URL(href!).searchParams.get("text") ?? "";
  writeFileSync(path.join(OUT, "P05-WhatsNota.txt"), `${text}\n`);
});
