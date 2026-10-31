// P04 in Playwright: build the extension for the local server and stand in for the two Chrome APIs the
// popup uses (chrome.storage.local, chrome.tabs.query). Used by ext-popup.e2e.ts and the F02 screenshot.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ARTIFACTS, ROOT } from "./helpers";

const OUT = path.join(ARTIFACTS, "extension-e2e");
export const PORTAL_TAB = "https://portal.ifood.com.br/financeiro/conciliacao";

/** chrome.storage.local and chrome.tabs.query, as the popup uses them. */
export const chromeStub = (tabUrl: string, token: string | null) => `
  (() => {
    const data = ${JSON.stringify(token ? { token } : {})};
    window.chrome = {
      storage: { local: {
        get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])),
        set: async (o) => { Object.assign(data, o); },
        remove: async (keys) => { for (const k of keys) delete data[k]; },
      } },
      tabs: { query: async () => [{ id: 1, url: ${JSON.stringify(tabUrl)} }] },
    };
  })();`;

export function buildExtension(api: string, out = OUT) {
  execFileSync("node", ["extension/build.mjs"], { cwd: ROOT, stdio: "pipe", env: { ...process.env, MARGO_API_URL: api, MARGO_EXT_OUT: path.relative(path.join(ROOT, "extension"), out) } });
  return pathToFileURL(path.join(out, "P04-popup.html")).href;
}

