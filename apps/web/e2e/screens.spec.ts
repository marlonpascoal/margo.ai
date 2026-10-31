// F02: each built console page at 390 px and 1280 px, saved next to the drawing's name for Marlon to compare.
import path from "node:path";
import { test } from "@playwright/test";
import { ARTIFACTS, FOUNDER_EMAIL, loginToConsole } from "./helpers";

const OUT = path.join(ARTIFACTS, "screens");
const WIDTHS = [390, 1280];
const SCREENS: [file: string, url: string][] = [
  ["C01-Clientes", "/console"],
  ["C14-Config", "/console/config"],
  ["C20-Funcionalidades", "/console/funcionalidades"],
  ["C21-Alertas", "/console/alertas"],
];

test("F02_C00_login", async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/console/login");
    await page.screenshot({ path: path.join(OUT, `C00-Login-${width}.png`), fullPage: true, caret: "initial" });
  }
});

test("F02_C01_C14_C20_C21_as_founder", async ({ page }) => {
  await loginToConsole(page, FOUNDER_EMAIL);
  for (const [file, url] of SCREENS) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      await page.screenshot({ path: path.join(OUT, `${file}-${width}.png`), fullPage: true, caret: "initial" });
    }
  }
});
