#!/usr/bin/env node
// Records Asaas SANDBOX responses and webhooks into fixtures/asaas/ (06 §4, D40: no invented responses).
// Marlon runs it; build agents never do (CLAUDE.md hard rule 3). See fixtures/asaas/README.md.
//
//   ASAAS_API_KEY=<sandbox key> node scripts/record_asaas.mjs api
//       creates a synthetic customer and a recurring card checkout in the sandbox, saves both responses,
//       and prints the checkout link to pay with an Asaas sandbox test card.
//   ASAAS_API_KEY=<sandbox key> node scripts/record_asaas.mjs payment <cus_id>
//       creates one single card charge (the pilot charge shape, D37) and saves the response.
//   ASAAS_API_KEY=<sandbox key> node scripts/record_asaas.mjs update-value <sub_id> <reais>
//       changes a sandbox subscription value for the next cycle and saves the response.
//   node scripts/record_asaas.mjs webhooks <export.json>
//       sanitizes raw webhook bodies (a JSON array, e.g. billing_event.payload exported from the dev project)
//       into fixtures/asaas/webhooks/<EVENT>.json. No key needed.
//
// Personal data is replaced before anything is written: names, e-mails, phones, documents, addresses,
// card data, IPs and URLs. Asaas ids, values, dates, statuses and event names are kept.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SANDBOX = "https://api-sandbox.asaas.com";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = path.join(ROOT, "fixtures", "asaas");

const REDACT_KEY = /name|email|phone|mobile|cpf|cnpj|document|address|postal|province|city|state|ip$|^ip|holder|creditcard|cardnumber|token|url|link|observations|company|birth|description/i;

/** Replaces personal fields in any JSON value; keeps structure, ids, values, dates and statuses. */
export function sanitize(value, key = "") {
  if (Array.isArray(value)) return value.map((v) => sanitize(v, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, k)]));
  }
  if (typeof value === "string" && REDACT_KEY.test(key) && !/^(cus|sub|pay|evt|chk)_/.test(value)) return "REDACTED";
  return value;
}

function save(rel, data) {
  const file = path.join(OUT, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(sanitize(data), null, 2)}\n`);
  console.log(`saved ${path.relative(ROOT, file)}`);
}

function config() {
  const key = process.env.ASAAS_API_KEY;
  const base = (process.env.ASAAS_API_URL || SANDBOX).replace(/\/+$/, "");
  if (!key) throw new Error("set ASAAS_API_KEY (sandbox) in this command only");
  if (base !== SANDBOX) throw new Error(`refusing ${base}: recordings come from the sandbox only`);
  return { key, base };
}

async function call(method, p, body) {
  const { key, base } = config();
  const res = await fetch(`${base}/v3${p}`, {
    method,
    headers: { "content-type": "application/json", access_token: key, "user-agent": "MargoAI recorder" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  console.log(`${method} ${p} -> ${res.status}`);
  return { status: res.status, body: json };
}

/** A synthetic CNPJ with valid check digits, made at run time (never a literal in git). */
function syntheticCnpj() {
  const base = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join("") + "0001";
  const dv = (d, w) => {
    const r = [...d].reduce((s, c, i) => s + Number(c) * w[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = dv(base, w1);
  return `${base}${d1}${dv(base + d1, [6, ...w1])}`;
}

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

async function api() {
  const customerReq = { name: "MargoAI Sintético", cpfCnpj: syntheticCnpj(), email: "sintetico@margoai.com", externalReference: "record-asaas", notificationDisabled: true };
  const customer = await call("POST", "/customers", customerReq);
  save("api/customers.create.json", { request: customerReq, status: customer.status, response: customer.body });
  if (!customer.body.id) return;
  // Same body as HttpAsaasClient.createCheckout (apps/web/lib/billing/asaas.ts).
  const checkoutReq = {
    billingTypes: ["CREDIT_CARD"],
    chargeTypes: ["RECURRENT"],
    customer: customer.body.id,
    externalReference: "record-asaas",
    callback: { successUrl: "https://example.com/app/plano?status=sucesso", cancelUrl: "https://example.com/app/plano?status=cancelado", expiredUrl: "https://example.com/app/plano?status=expirado" },
    items: [{ name: "MargoAI · plano Lucro", description: "1 cozinha · cobrança mensal no cartão", quantity: 1, value: 300 }],
    subscription: { cycle: "MONTHLY", nextDueDate: today() },
  };
  const checkout = await call("POST", "/checkouts", checkoutReq);
  // The link is kept here (before sanitizing) only to print it.
  const link = checkout.body.link;
  save("api/checkouts.create.json", { request: checkoutReq, status: checkout.status, response: checkout.body });
  if (link) console.log(`\nOpen and pay with an Asaas sandbox test card:\n${link}\n`);
}

async function payment(customerId) {
  if (!customerId) throw new Error("usage: payment <cus_id>");
  const req = { customer: customerId, billingType: "CREDIT_CARD", value: 47.6, dueDate: today(), description: "MargoAI piloto, teste", externalReference: "record-asaas-pilot" };
  const res = await call("POST", "/payments", req);
  save("api/payments.create.json", { request: req, status: res.status, response: res.body });
}

async function updateValue(subscriptionId, reais) {
  if (!subscriptionId || !reais) throw new Error("usage: update-value <sub_id> <reais>");
  const req = { value: Number(reais), updatePendingPayments: false };
  const res = await call("PUT", `/subscriptions/${encodeURIComponent(subscriptionId)}`, req);
  save("api/subscriptions.update.json", { request: req, status: res.status, response: res.body });
}

function webhooks(file) {
  if (!file) throw new Error("usage: webhooks <export.json>");
  const list = JSON.parse(readFileSync(file, "utf8"));
  const events = (Array.isArray(list) ? list : [list]).map((e) => (e && e.payload ? e.payload : e));
  for (const ev of events) {
    if (!ev || typeof ev.event !== "string") continue;
    let name = `webhooks/${ev.event}.json`;
    for (let i = 2; existsSync(path.join(OUT, name)); i++) name = `webhooks/${ev.event}.${i}.json`;
    save(name, ev);
  }
}

const [cmd, ...args] = process.argv.slice(2);
const run = { api, payment: () => payment(args[0]), "update-value": () => updateValue(args[0], args[1]), webhooks: () => webhooks(args[0]) }[cmd];
if (!run) {
  console.error("usage: node scripts/record_asaas.mjs api | payment <cus_id> | update-value <sub_id> <reais> | webhooks <export.json>");
  process.exit(2);
}
Promise.resolve(run()).catch((err) => {
  console.error(String(err.message ?? err));
  process.exit(1);
});
