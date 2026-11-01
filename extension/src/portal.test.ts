// P04 export on the Partner Portal page (05 P04, 06 §9, C07 "Envia sozinha uma vez por dia"). The page here is
// a small fake, SYNTHETIC: it is not iFood's DOM (we have no recording of it). The real-browser run against the
// synthetic page in fixtures/m2/extension is apps/web/e2e/ext-export.e2e.ts.
import { describe, expect, it } from "vitest";
import type { Status } from "./api";
import { dailyMessage, type DailyStore } from "./daily";
import {
  ARMED_ATTR,
  captureExport,
  DAILY_CLAIM,
  DAILY_DUE,
  DAILY_UPLOAD,
  dailyPlan,
  decodeFile,
  encodeFile,
  exportFromPage,
  findExportButton,
  HOOK_TAG,
  onReportPage,
  reportFileName,
  spDay,
  type ButtonLike,
  type CaptureEnv,
} from "./portal";

const PORTAL = "https://portal.ifood.com.br";

function button(text: string, attrs: Record<string, string> = {}, visible = true): ButtonLike & { clicks: number } {
  const b = {
    clicks: 0,
    textContent: text,
    hasAttribute: (n: string) => n in attrs,
    getAttribute: (n: string) => attrs[n] ?? null,
    getClientRects: () => ({ length: visible ? 1 : 0 }),
    click: () => void (b.clicks += 1),
  };
  return b;
}

/** A fake page: selector -> elements. */
const page = (bySelector: Record<string, ButtonLike[]>) => ({ querySelectorAll: (s: string) => bySelector[s] ?? [] });
const ANY_BUTTON = 'button, [role="button"]';

describe("P04 finds the Export button on the open page", () => {
  it("P04_export_button_by_configured_selector_first", () => {
    const tagged = button("", { "data-testid": "export-button" });
    expect(findExportButton(page({ '[data-testid="export-button"]': [tagged], [ANY_BUTTON]: [button("Exportar")] }))).toBe(tagged);
  });

  it("P04_export_button_by_text_skips_disabled_and_hidden", () => {
    const ok = button("  Exportar\n");
    const p = page({ [ANY_BUTTON]: [button("Filtrar"), button("Exportar", { disabled: "" }), button("Exportar", {}, false), button("Exportar", { "aria-disabled": "true" }), ok] });
    expect(findExportButton(p)).toBe(ok);
  });

  it("P04_no_export_button_is_null_so_the_popup_falls_back_to_the_file_pick", async () => {
    expect(findExportButton(page({ [ANY_BUTTON]: [button("Baixar")] }))).toBeNull();
    const env = fakeEnv(async () => new Blob());
    expect(await exportFromPage(page({}), env.env, 0)).toEqual({ ok: false, reason: "no-button" });
  });

  it("P04_acts_only_on_financial_pages_of_the_partner_portal", () => {
    expect(onReportPage(`${PORTAL}/financeiro/conciliacao`)).toBe(true);
    expect(onReportPage(`${PORTAL}/financeiro`)).toBe(true);
    expect(onReportPage(`${PORTAL}/financeiros`)).toBe(false);
    expect(onReportPage(`${PORTAL}/cardapio`)).toBe(false);
    expect(onReportPage("https://portal.ifood.com.br.exemplo.test/financeiro")).toBe(false);
    expect(onReportPage(undefined)).toBe(false);
  });
});

function fakeEnv(fetchUrl: (url: string) => Promise<Blob>) {
  const win = new EventTarget();
  const doc = new EventTarget();
  const attrs = new Map<string, string>();
  const env: CaptureEnv = {
    win,
    doc,
    root: { setAttribute: (n, v) => void attrs.set(n, v), removeAttribute: (n) => void attrs.delete(n) },
    origin: PORTAL,
    fetchUrl,
    now: () => new Date("2026-10-31T15:00:00Z"),
  };
  const hook = (data: Record<string, unknown>, origin = PORTAL) => win.dispatchEvent(new MessageEvent("message", { data: { tag: HOOK_TAG, ...data }, origin }));
  const clickLink = (href: string, download: string | null) => {
    const a = { href, getAttribute: (n: string) => (n === "download" ? download : n === "href" ? href : null) };
    const ev = new Event("click");
    Object.defineProperty(ev, "target", { value: { closest: () => a } });
    doc.dispatchEvent(ev);
  };
  return { env, attrs, hook, clickLink };
}

const CSV = "Pedido;Valor\n1001;42,50\n";

describe("P04 captures the file the portal hands over after the click", () => {
  it("C01_P04_blob_from_the_portal_with_its_link_name", async () => {
    const f = fakeEnv(async () => new Blob());
    const got = captureExport(f.env, 1000, 50);
    expect(f.attrs.get(ARMED_ATTR)).toBe("armed");
    f.hook({ kind: "blob", url: "blob:x/1", blob: new Blob([CSV], { type: "text/csv" }) });
    f.hook({ kind: "link", url: "blob:x/1", name: "conciliacao-out2026.csv" });
    const file = (await got)!;
    expect(file.name).toBe("conciliacao-out2026.csv");
    expect(await file.text()).toBe(CSV);
    expect(f.attrs.has(ARMED_ATTR)).toBe(false);
  });

  it("C01_P04_attached_download_link_is_read_like_the_page_would", async () => {
    const urls: string[] = [];
    const f = fakeEnv(async (u) => (urls.push(u), new Blob([CSV], { type: "text/csv" })));
    const got = captureExport(f.env, 1000, 50);
    f.clickLink(`${PORTAL}/api/relatorio/123`, "vendas.csv");
    f.clickLink(`${PORTAL}/api/relatorio/123`, "vendas.csv");
    expect((await got)!.name).toBe("vendas.csv");
    expect(urls).toEqual([`${PORTAL}/api/relatorio/123`]);
  });

  it("P04_ignores_messages_from_other_origins_ordinary_links_and_non_reports", async () => {
    const f = fakeEnv(async () => new Blob([CSV]));
    const got = captureExport(f.env, 150, 10);
    f.hook({ kind: "blob", url: "blob:y", blob: new Blob([CSV], { type: "text/csv" }) }, "https://outro.exemplo.test");
    f.clickLink(`${PORTAL}/financeiro/repasses`, null);
    f.hook({ kind: "blob", url: "blob:img", blob: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0])], { type: "image/png" }) });
    expect(await got).toBeNull();
    expect(f.attrs.has(ARMED_ATTR)).toBe(false);
  });

  it("C01_P04_export_from_page_clicks_once_and_encodes_the_file", async () => {
    const f = fakeEnv(async () => new Blob());
    const b = button("Exportar");
    b.click = () => {
      b.clicks += 1;
      f.hook({ kind: "blob", url: "blob:z", blob: new Blob([CSV], { type: "text/csv" }) });
    };
    const r = await exportFromPage(page({ [ANY_BUTTON]: [b] }), f.env, 0);
    expect(b.clicks).toBe(1);
    expect(r).toMatchObject({ ok: true, file: { name: "portal-ifood-2026-10-31.csv", type: "text/csv" } });
    if (r?.ok) expect(await decodeFile(r.file).text()).toBe(CSV);
  });

  it("P04_claim_refused_means_no_click", async () => {
    const b = button("Exportar");
    expect(await exportFromPage(page({ [ANY_BUTTON]: [b] }), fakeEnv(async () => new Blob()).env, 0, async () => false)).toBeNull();
    expect(b.clicks).toBe(0);
  });

  it("P04_file_names_only_csv_or_xlsx", () => {
    const now = new Date("2026-10-31T02:00:00Z"); // still 30/out in São Paulo
    expect(reportFileName("C:\\fakepath\\Relatório.XLSX", "", new Uint8Array(), now)).toBe("Relatório.XLSX");
    expect(reportFileName(null, "", new Uint8Array([0x50, 0x4b, 3, 4]), now)).toBe("portal-ifood-2026-10-30.xlsx");
    expect(reportFileName("", "text/csv;charset=utf-8".split(";")[0], new Uint8Array([65]), now)).toBe("portal-ifood-2026-10-30.csv");
    expect(reportFileName("foto.png", "image/png", new Uint8Array([0x89, 0]), now)).toBeNull();
  });

  it("P04_file_survives_runtime_messaging", async () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 256);
    const back = decodeFile(await encodeFile(new File([bytes], "a.xlsx", { type: "x" })));
    expect(back.name).toBe("a.xlsx");
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(bytes);
  });
});

const status = (lastUpload: string | null, stores = [{ id: "s1", name: "Pantanos Burguer Igapó" }]): Status => ({
  account: { name: "Pantanos Burguer", synthetic: true },
  person: "Dono",
  stores,
  reports: [
    { key: "vendas_por_item", name: "Vendas por item", period: "set/2026", requested: true },
    { key: "promocoes", name: "Extrato de promoções e campanhas", period: "set/2026", requested: true },
    { key: "avaliacoes", name: "Avaliações da loja", period: "não precisamos agora", requested: false },
  ],
  lastUpload,
});

describe("C07 Envia sozinha uma vez por dia", () => {
  const now = new Date("2026-10-31T15:00:00Z");

  it("C07_due_when_nothing_was_sent_or_tried_today_in_sao_paulo", () => {
    expect(spDay(now)).toBe("2026-10-31");
    expect(dailyPlan(status("2026-10-29T00:14:00Z"), null, now)).toEqual({ due: true, storeId: "s1", reports: ["vendas_por_item", "promocoes"] });
    expect(dailyPlan(status(null), "2026-10-30", now).due).toBe(true);
    expect(dailyPlan(status("2026-10-31T03:30:00Z"), null, now).due).toBe(false); // 00:30 in São Paulo, today
    expect(dailyPlan(status(null), "2026-10-31", now).due).toBe(false);
    expect(dailyPlan(status(null, [{ id: "a", name: "A" }, { id: "b", name: "B" }]), null, now).storeId).toBeNull();
  });

  function memoryDay(initial: string | null = null): DailyStore & { day: string | null } {
    const s = { day: initial, get: async () => s.day, set: async (d: string) => void (s.day = d) };
    return s;
  }

  it("C07_two_tabs_claim_the_day_once", async () => {
    const store = memoryDay("2026-10-30");
    const client = { status: async () => ({ ok: true as const, value: status(null) }), upload: async () => ({ ok: true as const, value: { importRunId: "r" } }) };
    const claims = await Promise.all([dailyMessage({ type: DAILY_CLAIM }, client, store, now), dailyMessage({ type: DAILY_CLAIM }, client, store, now)]);
    expect(claims.sort()).toEqual([false, true]);
    expect(await dailyMessage({ type: DAILY_DUE }, client, store, now)).toMatchObject({ due: false });
  });

  it("C01_C06_daily_upload_sends_the_file_reports_and_store; a refusal comes back as written", async () => {
    const sent: { name: string; storeId: string | null; reports: string[] }[] = [];
    const refusal = { ok: false as const, kind: "refused" as const, message: "Sem autorização do dono para este CNPJ. A importação espera a autorização assinada." };
    const answers = [{ ok: true as const, value: { importRunId: "r1" } }, refusal];
    const client = {
      status: async () => ({ ok: true as const, value: status(null) }),
      upload: async (f: File, storeId: string | null, reports: string[]) => (sent.push({ name: f.name, storeId, reports }), answers.shift()!),
    };
    const file = await encodeFile(new File([CSV], "vendas.csv", { type: "text/csv" }));
    const msg = { type: DAILY_UPLOAD, file, storeId: "s1", reports: ["vendas_por_item", 7] };
    expect(await dailyMessage(msg, client, memoryDay(), now)).toEqual({ ok: true, value: { importRunId: "r1" } });
    expect(await dailyMessage(msg, client, memoryDay(), now)).toEqual(refusal);
    expect(sent[0]).toEqual({ name: "vendas.csv", storeId: "s1", reports: ["vendas_por_item"] });
  });

  it("P04_unpaired_extension_is_never_due_and_unknown_messages_are_ignored", async () => {
    const client = { status: async () => ({ ok: false as const, kind: "unpaired" as const, message: "x" }), upload: async () => ({ ok: true as const, value: { importRunId: "r" } }) };
    expect(await dailyMessage({ type: DAILY_DUE }, client, memoryDay(), now)).toBeNull();
    expect(dailyMessage({ type: "outra" }, client, memoryDay(), now)).toBeNull();
  });
});
