#!/usr/bin/env node
// After `supabase db reset`: put the files behind G-SYN's seeded import runs (C07 "Rerun", C17) into the
// local Storage bucket `imports`. Local stack only; the URL and key are its public defaults (D44).
// The files are the synthetic statements of fixtures/m2 (SINTÉTICO); the 28/out upload keeps its drawn name.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALIAS = { "extrato-99food-set.xlsx": "99food-extrato-set2026-SINTETICO.xlsx" };

const status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const url = status.API_URL;
const key = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
const headers = { authorization: `Bearer ${key}`, apikey: key };

const res = await fetch(`${url}/rest/v1/import_run?select=file_path&file_path=like.imports/*`, { headers });
if (!res.ok) throw new Error(`reading import_run: ${res.status}`);
const runs = await res.json();
let n = 0;
for (const { file_path: filePath } of runs) {
  const base = path.basename(filePath);
  const body = readFileSync(path.join(ROOT, "fixtures", "m2", ALIAS[base] ?? base));
  const type = base.endsWith(".csv") ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const put = await fetch(`${url}/storage/v1/object/${filePath.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: { ...headers, "content-type": type, "x-upsert": "true" },
    body,
  });
  if (!put.ok) throw new Error(`uploading ${filePath}: ${put.status} ${await put.text()}`);
  n += 1;
}
console.log(`seed_storage: ${n} files in bucket imports`);
