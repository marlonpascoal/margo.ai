// P04 pairing and upload client with a fake fetch (06 §9): the token goes only to our API as a Bearer header,
// a 401 forgets it, a 404 means the flag is off (A05), and the upload carries only the chosen file.
import { describe, expect, it } from "vitest";
import { createClient, MESSAGES, type Fetch, type TokenStore } from "./api";
import { hostPermissions } from "./config";
import { lastUploadLabel, NOTE, onPartnerPortal } from "./view";

function memoryTokens(initial: string | null = null): TokenStore & { value: string | null } {
  const t = { value: initial, get: async () => t.value, set: async (v: string) => void (t.value = v), clear: async () => void (t.value = null) };
  return t;
}

function fakeFetch(answers: { status: number; body: unknown }[] | Error) {
  const calls: { url: string; method?: string; headers?: Record<string, string>; body?: string | FormData }[] = [];
  const f: Fetch = async (url, init) => {
    calls.push({ url, ...init });
    if (answers instanceof Error) throw answers;
    const a = answers.shift()!;
    return { status: a.status, json: async () => a.body };
  };
  return { f, calls };
}

const API = "https://api.exemplo.test";

describe("P04 pairing", () => {
  it("P04_pair_exchanges_the_code_for_a_token_kept_locally", async () => {
    const { f, calls } = fakeFetch([{ status: 200, body: { token: "mgx_abc", account: "Pantanos Burguer" } }]);
    const tokens = memoryTokens();
    expect(await createClient(API, f, tokens).pair("k7m4 q9tx")).toEqual({ ok: true, value: { account: "Pantanos Burguer" } });
    expect(tokens.value).toBe("mgx_abc");
    expect(calls).toEqual([{ url: `${API}/api/extension/pair`, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "k7m4 q9tx" }) }]);
  });

  it("P04_bad_code_keeps_no_token_and_says_why", async () => {
    const { f } = fakeFetch([{ status: 404, body: { error: "Código inválido ou vencido. Gere um código novo no portal." } }]);
    const tokens = memoryTokens();
    expect(await createClient(API, f, tokens).pair("x")).toEqual({ ok: false, kind: "refused", message: "Código inválido ou vencido. Gere um código novo no portal." });
    expect(tokens.value).toBeNull();
  });
});

describe("P04 status and upload", () => {
  it("P04_status_sends_the_bearer_token_to_our_api_only", async () => {
    const status = { account: { name: "Pantanos Burguer", synthetic: true }, person: "Dono", stores: [], reports: [], lastUpload: null };
    const { f, calls } = fakeFetch([{ status: 200, body: status }]);
    expect(await createClient(API, f, memoryTokens("mgx_abc")).status()).toEqual({ ok: true, value: status });
    expect(calls[0]).toMatchObject({ url: `${API}/api/extension/status`, method: "GET", headers: { authorization: "Bearer mgx_abc" } });
  });

  it("P04_without_token_asks_for_pairing_without_calling", async () => {
    const { f, calls } = fakeFetch([]);
    expect(await createClient(API, f, memoryTokens()).status()).toEqual({ ok: false, kind: "unpaired", message: MESSAGES.unpaired });
    expect(calls).toEqual([]);
  });

  it("P04_revoked_token_401_is_forgotten; A05_flag_off_404_says_off", async () => {
    const tokens = memoryTokens("mgx_old");
    const { f } = fakeFetch([{ status: 401, body: { error: "Extensão não conectada. Gere um código novo no portal." } }, { status: 404, body: {} }]);
    const client = createClient(API, f, tokens);
    expect(await client.status()).toMatchObject({ ok: false, kind: "unpaired" });
    expect(tokens.value).toBeNull();
    await tokens.set("mgx_new");
    expect(await client.status()).toEqual({ ok: false, kind: "off", message: MESSAGES.off });
  });

  it("P04_network_error_is_said_plainly", async () => {
    const { f } = fakeFetch(new Error("offline"));
    expect(await createClient(API, f, memoryTokens("mgx_abc")).status()).toEqual({ ok: false, kind: "network", message: MESSAGES.network });
  });

  it("P04_upload_sends_the_chosen_file_store_and_reports_only", async () => {
    const { f, calls } = fakeFetch([{ status: 201, body: { importRunId: "run-1" } }, { status: 403, body: { error: "Sem autorização do dono para este CNPJ. A importação espera a autorização assinada." } }]);
    const client = createClient(`${API}/`, f, memoryTokens("mgx_abc"));
    const file = new File(["a;b\n"], "conciliacao.csv", { type: "text/csv" });
    expect(await client.upload(file, "store-1", ["vendas_por_item", "promocoes"])).toEqual({ ok: true, value: { importRunId: "run-1" } });
    const form = calls[0].body as FormData;
    expect(calls[0]).toMatchObject({ url: `${API}/api/extension/upload`, method: "POST", headers: { authorization: "Bearer mgx_abc" } });
    expect([...form.keys()]).toEqual(["arquivo", "loja", "relatorio", "relatorio"]);
    expect((form.get("arquivo") as File).name).toBe("conciliacao.csv");
    expect(form.getAll("relatorio")).toEqual(["vendas_por_item", "promocoes"]);
    // C06: the server's refusal reaches the owner as it was written.
    expect(await client.upload(file, null, [])).toEqual({ ok: false, kind: "refused", message: "Sem autorização do dono para este CNPJ. A importação espera a autorização assinada." });
  });
});

describe("P04 labels and hosts", () => {
  it("last upload as drawn, in São Paulo time, with the fictitious label for synthetic accounts", () => {
    expect(lastUploadLabel("2026-10-29T00:14:00Z", true)).toBe("último envio: 28/out 21:14 · dados fictícios");
    expect(lastUploadLabel("2026-10-29T00:14:00Z", false)).toBe("último envio: 28/out 21:14");
    expect(lastUploadLabel(null, false)).toBe("último envio: ainda não enviou");
  });

  it("works only on the Partner Portal tab", () => {
    expect(onPartnerPortal("https://portal.ifood.com.br/financeiro/conciliacao")).toBe(true);
    expect(onPartnerPortal("https://portal.ifood.com.br.exemplo.test/")).toBe(false);
    expect(onPartnerPortal("https://www.ifood.com.br/")).toBe(false);
    expect(onPartnerPortal(undefined)).toBe(false);
  });

  it("host permissions: the Partner Portal and our API origin, nothing else", () => {
    expect(hostPermissions("https://app.exemplo.test/x")).toEqual(["https://portal.ifood.com.br/*", "https://app.exemplo.test/*"]);
  });

  it("no em dash in what the owner reads", () => {
    for (const s of [NOTE, ...Object.values(MESSAGES)]) expect(s).not.toContain("—");
  });
});
