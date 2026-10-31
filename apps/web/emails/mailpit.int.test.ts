// E02 end to end on the local stack: notify(), the outbox and the local Mailpit (the dev inbox). Nothing leaves
// the machine. Creates and deletes its own synthetic account.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notify, processOutbox } from "@/lib/notify/outbox";
import { ChannelNotifier, MailpitProvider, ManualWhatsAppProvider } from "@/lib/notify/providers";
import { SupabaseNotifyStore } from "@/lib/notify/supabase-store";
import { adminClient } from "@/lib/supabase/admin";
import { EXAMPLES, emailSource } from "./index";

const db = adminClient();
const tag = randomBytes(4).toString("hex");
const email = `mailpit-${tag}@teste.local`;
const mailpit = () => process.env.MAILPIT_URL!;
let accountId = "";
let personId = "";

beforeAll(async () => {
  const acc = await db.from("account").insert({ name: "Grupo Exemplo", code: `T-MP-${tag}`, is_synthetic: true }).select("id").single();
  accountId = acc.data!.id;
  const p = await db.from("person").insert({ name: "Dono e-mail", email }).select("id").single();
  personId = p.data!.id;
  await db.from("membership").insert({ account_id: accountId, person_id: personId, role: "dono" });
});

afterAll(async () => {
  await db.from("account").delete().eq("id", accountId);
  await db.from("person").delete().eq("id", personId);
  await fetch(`${mailpit()}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`, { method: "DELETE" });
});

describe("E02 in the local Mailpit", () => {
  it("E02_int_deadline_email_arrives_with_html_text_and_synthetic_label", async () => {
    const now = new Date("2026-11-12T10:00:00-03:00");
    const store = new SupabaseNotifyStore(db);
    await notify({ store, now: () => now }, { code: "deadline_soon", accountId, message: emailSource(EXAMPLES.deadline_soon, { synthetic: true }) });
    const notifier = new ChannelNotifier({ email: new MailpitProvider(mailpit()), whatsappManual: new ManualWhatsAppProvider() });
    // Only this account's rows: other tests may leave queued rows behind.
    const scoped = Object.assign(Object.create(store), { outbox: async (n: number) => (await store.outbox(n * 50)).filter((r) => r.accountId === accountId) });
    expect(await processOutbox({ store: scoped, notifier, now: () => now })).toMatchObject({ sent: 1, failed: 0 });

    const list = (await (await fetch(`${mailpit()}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as { messages: { ID: string; Subject: string }[] };
    expect(list.messages.map((m) => m.Subject)).toEqual(["Faltam 3 dias para contestar R$ 640 no iFood"]);
    const msg = (await (await fetch(`${mailpit()}/api/v1/message/${list.messages[0].ID}`)).json()) as { HTML: string; Text: string; From: { Address: string } };
    expect(msg.From.Address).toBe("avisos@margoai.com");
    expect(msg.HTML).toContain("O prazo para contestar o cupom cofinanciado acaba em 15/nov");
    expect(msg.Text).toContain("SINTÉTICO · dados fictícios");
    expect(msg.Text).toContain("Você recebe este e-mail porque é Dono no Grupo Exemplo.");
  });
});
