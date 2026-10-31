// 05 P04 "Done when": the built manifest has host permission only for the Partner Portal and our API.
// The popup's colors come from the design tokens only.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { manifest, tokensCss } from "./build.mjs";

describe("P04 manifest", () => {
  it("P04_host_permissions_are_the_partner_portal_and_the_api_only", () => {
    const m = manifest("https://app.exemplo.test");
    expect(m.manifest_version).toBe(3);
    expect(m.host_permissions).toEqual(["https://portal.ifood.com.br/*", "https://app.exemplo.test/*"]);
    expect(m.permissions).toEqual(["storage"]);
    expect(m).not.toHaveProperty("content_scripts");
    expect(m).not.toHaveProperty("background");
    expect(m.action.default_popup).toBe("P04-popup.html");
  });

  it("popup uses design tokens, not hand-written colors", () => {
    const css = tokensCss(readFileSync(new URL("../apps/web/app/tokens.css", import.meta.url), "utf8"));
    expect(css).toContain("--color-ink: #1C1C1A;");
    expect(css).not.toContain("--color-*");
    for (const f of readdirSync(new URL("./src", import.meta.url))) {
      if (/\.(css|ts|html)$/.test(f)) expect(readFileSync(new URL(`./src/${f}`, import.meta.url), "utf8"), f).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
    }
  });
});
