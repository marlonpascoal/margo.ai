// Integration tests against the local Supabase stack: pnpm test:int.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { include: ["**/*.int.test.ts"], exclude: ["node_modules", ".next"], fileParallelism: false, testTimeout: 30_000 },
});
