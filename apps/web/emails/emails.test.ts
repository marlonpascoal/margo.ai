// E01, E02 and the other eight notices of 04 §9: subject, key numbers, footer, SINTÉTICO, no em dash (D22, D46).
import { describe, expect, it } from "vitest";
import { FakeNotifyStore } from "@/lib/notify/fake-store";
import { notify } from "@/lib/notify/outbox";
import type { Recipient } from "@/lib/notify/plan";
import { MailpitProvider } from "@/lib/notify/providers";
import type { NoticeCode } from "@/lib/notify/templates";
import { closeReadyEmail } from "./E01-fechamento";
import { DRAWN, EXAMPLES, emailSource } from "./index";
import { renderEmail, SYNTHETIC_LABEL } from "./layout";

const dono: Recipient = { personId: "p", accountId: "a", accountName: "Grupo Exemplo", role: "dono", email: "dono@exemplo.com.br", whatsappE164: "+5543900001234" };
const BASE = "https://app.exemplo.test";
const render = (code: NoticeCode, synthetic = true) => renderEmail(EXAMPLES[code], dono, { synthetic, baseUrl: BASE });
const EM_DASH = "—";

describe("E01 fechamento do mês pronto", () => {
  it("E01_subject_and_numbers_as_drawn", () => {
    const m = render("close_ready");
    expect(m.subject).toBe("Setembro fechado: sobrou R$ 86.800 de R$ 248.000");
    expect(m.html).toContain("Seu fechamento de setembro está pronto");
    expect(m.html).toContain("Grupo Exemplo, 2 cozinhas, iFood e 99Food.");
    for (const [label, value] of [
      ["Vendido no delivery", "R$ 248.000"],
      ["Recebido dos apps", "R$ 186.300"],
      ["Sobrou depois dos insumos", "R$ 86.800"],
      ["Cobrado errado, para contestar", "R$ 2.410"],
    ]) {
      expect(m.html).toContain(label);
      expect(m.body).toContain(`${label}: ${value}`);
    }
    expect(m.body).toContain(`Abrir o fechamento: ${BASE}/app`);
    expect(m.body).toContain("O PDF vai anexo. Os números ficam também no seu portal, por cozinha e por app.");
  });

  it("E01_without_cost_says_falta_custo_and_the_subject_says_received", () => {
    const c = closeReadyEmail({ accountName: "Grupo Exemplo", month: "2026-09-01", kitchens: 2, channels: ["iFood", "99Food"], grossCents: 11_100_000, payoutCents: 8_330_000, leftCents: null, wrongCents: 118_400 });
    expect(c.subject).toBe("Setembro fechado: recebeu R$ 83.300 de R$ 111.000");
    const m = renderEmail(c, dono, { synthetic: false, baseUrl: BASE });
    expect(m.body).toContain("Sobrou depois dos insumos: falta custo");
    expect(m.body).toContain("Cobrado errado, para contestar: R$ 1.184");
  });

  it("E01_carries_the_pdf_attachment_path", () => {
    const m = renderEmail(EXAMPLES.close_ready, dono, { synthetic: true, attachmentPath: "closes/G-02/2026-09/fechamento-G-02-2026-09.pdf" });
    expect(m.attachmentPath).toBe("closes/G-02/2026-09/fechamento-G-02-2026-09.pdf");
  });
});

describe("E02 prazo de contestação", () => {
  it("E02_subject_deadline_amount_and_link_to_the_claim_text", () => {
    const m = render("deadline_soon");
    expect(m.subject).toBe("Faltam 3 dias para contestar R$ 640 no iFood");
    expect(m.html).toContain("O prazo para contestar o cupom cofinanciado acaba em 15/nov");
    expect(m.html).toContain("31 pedidos da Cozinha Centro tiveram o desconto do cupom debitado inteiro da loja.");
    expect(m.html).toContain("R$ 640,00");
    expect(m.html).toContain("Abra um chamado no Portal do Parceiro do iFood e cole o texto.");
    expect(m.html).toContain("<b>Já contestei</b>");
    expect(m.body).toContain(`Ver o texto pronto: ${BASE}/app/contestacoes`);
    expect(m.body).toContain("Se o crédito aparecer no repasse, a gente marca como creditada sozinho e avisa você.");
  });
});

describe("every notice", () => {
  const codes = Object.keys(EXAMPLES) as NoticeCode[];

  it("E05_ten_notices_have_a_template", () => {
    expect(codes.sort()).toEqual(
      ["billing_result", "close_ready", "credit_confirmed", "data_stale", "deadline_soon", "invoices_missing", "new_difference", "security_event", "trial_ending", "weekly_summary"],
    );
    expect(DRAWN).toEqual({ close_ready: "E01", deadline_soon: "E02" });
  });

  it.each(codes)("%s: drawn footer, no em dash, html and text", (code) => {
    const m = render(code);
    expect(m.subject.length).toBeGreaterThan(5);
    for (const part of [m.subject, m.body, m.html!, m.whatsapp!]) expect(part).not.toContain(EM_DASH);
    expect(m.html).toContain("Você recebe este e-mail porque é Dono no Grupo Exemplo.");
    expect(m.html).toContain(`<a href="${BASE}/app/notificacoes"`);
    expect(m.body).toContain(`Mudar notificações: ${BASE}/app/notificacoes`);
    expect(m.html!.startsWith("<!doctype html>")).toBe(true);
  });

  it.each(codes)("%s: SINTÉTICO only for synthetic accounts", (code) => {
    const syn = render(code, true);
    expect(syn.html).toContain(SYNTHETIC_LABEL);
    expect(syn.body).toContain(SYNTHETIC_LABEL);
    expect(syn.whatsapp).toContain("SINTÉTICO");
    const real = render(code, false);
    for (const part of [real.body, real.html!, real.whatsapp!]) expect(part).not.toContain("SINTÉTICO");
  });

  it("escapes data in HTML", () => {
    const m = renderEmail({ ...EXAMPLES.data_stale, title: "<script>x</script>" }, { ...dono, accountName: "A & B" }, { synthetic: false, baseUrl: BASE });
    expect(m.html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(m.html).toContain("A &amp; B");
  });

  it("uses design tokens, not hand-written colors", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["layout.ts", "E01-fechamento.ts", "E02-prazo.ts", "notices.ts"]) {
      expect(readFileSync(new URL(`./${f}`, import.meta.url), "utf8")).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
    }
  });
});

describe("E05 notify with a template", () => {
  it("E05_template_email_row_keeps_html_and_its_own_footer_once", async () => {
    const store = new FakeNotifyStore();
    store.accounts.set("acc", "Grupo Exemplo");
    store.people.push({ id: "dono", name: "Dono", email: "dono@exemplo.com.br", whatsappE164: "+5543912341234", memberships: [{ accountId: "acc", role: "dono" }] });
    const now = new Date("2026-11-05T14:00:00-03:00");
    await notify({ store, now: () => now }, { code: "deadline_soon", accountId: "acc", message: emailSource(EXAMPLES.deadline_soon, { synthetic: true, baseUrl: BASE }) });
    const mail = store.notifications.find((n) => n.channel === "email")!;
    expect(mail.subject).toBe("Faltam 3 dias para contestar R$ 640 no iFood");
    expect(mail.html).toContain("O prazo para contestar o cupom cofinanciado acaba em 15/nov");
    expect(mail.body.match(/Você recebe este e-mail/g)).toHaveLength(1);
    const wa = store.notifications.find((n) => n.channel === "whatsapp_manual")!;
    expect(wa.body).toContain("faltam 3 dias para contestar R$ 640,00 no iFood");
    expect(wa.html ?? null).toBeNull();
  });
});

describe("Mailpit provider (local dev inbox)", () => {
  it("sends HTML, text and the attachment to the local Mailpit send API", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fakeFetch = async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ ID: "abc" }) };
    };
    const p = new MailpitProvider("http://127.0.0.1:54324/", fakeFetch, async (path) => ({ filename: path.split("/").pop()!, contentType: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) }));
    const r = await p.send({ notificationId: "n1", channel: "email", to: "dono@exemplo.com.br", subject: "S", body: "T", html: "<p>H</p>", attachmentPath: "closes/G-02/x.pdf" });
    expect(r.providerId).toBe("mailpit:abc");
    expect(calls[0].url).toBe("http://127.0.0.1:54324/api/v1/send");
    expect(calls[0].body).toMatchObject({
      From: { Name: "MargoAI", Email: "avisos@margoai.com" },
      To: [{ Email: "dono@exemplo.com.br" }],
      Subject: "S",
      Text: "T",
      HTML: "<p>H</p>",
      Attachments: [{ Filename: "x.pdf", ContentType: "application/pdf", Content: "JVBERg==" }],
    });
  });

  it("fails loudly when Mailpit refuses", async () => {
    const p = new MailpitProvider("http://127.0.0.1:1", async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(p.send({ notificationId: "n", channel: "email", to: "x@exemplo.com.br", subject: "S", body: "T" })).rejects.toThrow("500");
  });
});
