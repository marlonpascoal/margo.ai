// Playwright against `next dev` on the local Supabase stack (scripts/with-local-env.mjs).
//   pnpm e2e           acceptance flows (E03, C14 secrets, Operação 404)
//   pnpm e2e:screens   F02 screenshots at 390 and 1280 px into artifacts/screens/
import { defineConfig } from "@playwright/test";
import { E2E_FAKE_SECRETS } from "./e2e/fake-secrets";

const port = Number(process.env.E2E_PORT ?? 3108);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../../artifacts/playwright",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [["list"]],
  use: { baseURL, locale: "pt-BR", timezoneId: "America/Sao_Paulo" },
  projects: [
    { name: "e2e", testMatch: /.*\.e2e\.ts/ },
    { name: "screens", testMatch: /screens\.spec\.ts/ },
  ],
  webServer: {
    command: `node ../../scripts/with-local-env.mjs next dev -p ${port}`,
    url: `${baseURL}/console/login`,
    // Always our own server, so it carries E2E_FAKE_SECRETS.
    reuseExistingServer: false,
    timeout: 180_000,
    env: { ...E2E_FAKE_SECRETS },
  },
});
