// P04 client of /api/extension (06 §9). The token lives in chrome.storage.local and goes only to our API, as a
// Bearer header. No password, no cookie, no page content: only the exported report file.

export interface Report {
  key: string;
  name: string;
  period: string;
  requested: boolean;
}

export interface Status {
  account: { name: string; synthetic: boolean };
  person: string;
  stores: { id: string; name: string }[];
  reports: Report[];
  lastUpload: string | null;
}

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | FormData }) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface TokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

export type Result<T> = { ok: true; value: T } | { ok: false; kind: "unpaired" | "off" | "refused" | "network"; message: string };

/** Not drawn: short messages for the popup, listed for Marlon. */
export const MESSAGES = {
  network: "Sem conexão com a MargoAI. Tente de novo em instantes.",
  off: "A extensão está desligada para esta conta. Fale com a MargoAI.",
  unpaired: "Conecte a extensão com o código do portal.",
  sent: "Arquivo enviado. A MargoAI importa em alguns minutos.",
  exporting: "Exportando no Portal do Parceiro...",
  pickFile: "Não achei o botão Exportar nesta página. Escolha o arquivo que você exportou.",
  noDownload: "O portal não entregou o arquivo. Exporte você mesmo e clique de novo para escolher o arquivo.",
} as const;

export function createClient(base: string, fetchImpl: Fetch, tokens: TokenStore) {
  const url = (p: string) => `${base.replace(/\/$/, "")}/api/extension/${p}`;

  async function call<T>(path: string, init: { method?: string; body?: string | FormData; headers?: Record<string, string> }, authed: boolean): Promise<Result<T>> {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (authed) {
      const token = await tokens.get();
      if (!token) return { ok: false, kind: "unpaired", message: MESSAGES.unpaired };
      headers.authorization = `Bearer ${token}`;
    }
    let res: { status: number; json(): Promise<unknown> };
    try {
      res = await fetchImpl(url(path), { ...init, headers });
    } catch {
      return { ok: false, kind: "network", message: MESSAGES.network };
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status >= 200 && res.status < 300) return { ok: true, value: body as T };
    if (authed && res.status === 401) {
      await tokens.clear();
      return { ok: false, kind: "unpaired", message: typeof body.error === "string" ? body.error : MESSAGES.unpaired };
    }
    if (res.status === 404 && authed) return { ok: false, kind: "off", message: MESSAGES.off };
    return { ok: false, kind: "refused", message: typeof body.error === "string" ? body.error : MESSAGES.network };
  }

  return {
    /** Exchanges the short code for the long token, kept in chrome.storage.local. */
    async pair(code: string): Promise<Result<{ account: string }>> {
      const r = await call<{ token: string; account: string }>("pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) }, false);
      if (!r.ok) return r;
      await tokens.set(r.value.token);
      return { ok: true, value: { account: r.value.account } };
    },
    status: () => call<Status>("status", { method: "GET" }, true),
    /** Sends the exported report file; nothing else from the page. */
    async upload(file: File, storeId: string | null, reports: string[]): Promise<Result<{ importRunId: string }>> {
      const form = new FormData();
      form.set("arquivo", file);
      if (storeId) form.set("loja", storeId);
      for (const r of reports) form.append("relatorio", r);
      return call<{ importRunId: string }>("upload", { method: "POST", body: form }, true);
    },
  };
}

export type Client = ReturnType<typeof createClient>;

/** chrome.storage.local, key "token". */
export const chromeTokens = (): TokenStore => ({
  async get() {
    const v = (await chrome.storage.local.get(["token"])).token;
    return typeof v === "string" ? v : null;
  },
  set: (token) => chrome.storage.local.set({ token }),
  clear: () => chrome.storage.local.remove(["token"]),
});
