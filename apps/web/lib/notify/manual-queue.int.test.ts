// E05, A04, 06 §7 against the local stack: a founder marks a manual WhatsApp as sent from C21; quiet hours hold
// owner messages; owners cannot mark; every mark is audited. Creates and deletes its own synthetic account.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient } from "@/lib/supabase/admin";
import { loadManualQueue, markWhatsAppSent, MANUAL_MESSAGES } from "./manual-queue";

const db = adminClient();
const tag = randomBytes(4).toString("hex");
const meta = { ip: "203.0.113.7", userAgent: "vitest" };
const sp = (iso: string) => new Date(`${iso}-03:00`);
let accountId = "";
const ids = { dono: "", staff: "", row: "" };

beforeAll(async () => {
  const acc = await db.from("account").insert({ name: "Conta fila WhatsApp", code: `T-WA-${tag}`, is_synthetic: true }).select("id").single();
  accountId = acc.data!.id;
  const people = await db
    .from("person")
    .insert([
      { name: "Dono fila", email: `wa-dono-${tag}@teste.local`, whatsapp_e164: "+5543911112222" },
      { name: "Fundador fila", email: `wa-staff-${tag}@teste.local` },
    ])
    .select("id, email");
  ids.dono = people.data!.find((p) => p.email!.startsWith("wa-dono"))!.id;
  ids.staff = people.data!.find((p) => p.email!.startsWith("wa-staff"))!.id;
  await db.from("membership").insert({ account_id: accountId, person_id: ids.dono, role: "dono" });
  await db.from("staff").insert({ person_id: ids.staff, role: "fundador" });
  const n = await db
    .from("notification")
    .insert({ account_id: accountId, person_id: ids.dono, notice_code: "deadline_soon", channel: "whatsapp_manual", body: `Faltam 3 dias ${tag}`, recipient: "+5543911112222" })
    .select("id")
    .single();
  ids.row = n.data!.id;
});

afterAll(async () => {
  await db.from("audit_log").delete().eq("account_id", accountId);
  await db.from("account").delete().eq("id", accountId);
  await db.from("staff").delete().eq("person_id", ids.staff);
  await db.from("person").delete().in("id", [ids.dono, ids.staff]);
});

describe("06 §7 manual WhatsApp queue", () => {
  it("E05_int_queue_lists_the_row_and_holds_it_at_night", async () => {
    const day = (await loadManualQueue(db, sp("2026-11-05T14:00:00"), 500)).find((r) => r.id === ids.row)!;
    expect(day).toMatchObject({ state: "ready", client: `Conta fila WhatsApp (T-WA-${tag})`, notice: "Prazo de contestação chegando" });
    expect(day.link).toBe(`https://wa.me/5543911112222?text=${encodeURIComponent(`Faltam 3 dias ${tag}`)}`);
    expect(await markWhatsAppSent(db, ids.row, ids.staff, meta, sp("2026-11-05T23:00:00"))).toEqual({ ok: false, message: MANUAL_MESSAGES.held });
  });

  it("A04_int_owner_cannot_mark_founder_marks_once_and_it_is_audited", async () => {
    expect(await markWhatsAppSent(db, ids.row, ids.dono, meta, sp("2026-11-05T14:00:00"))).toEqual({ ok: false, message: MANUAL_MESSAGES.staffOnly });
    expect(await markWhatsAppSent(db, ids.row, ids.staff, meta, sp("2026-11-05T14:00:00"))).toEqual({ ok: true });
    expect(await markWhatsAppSent(db, ids.row, ids.staff, meta, sp("2026-11-05T14:01:00"))).toEqual({ ok: false, message: MANUAL_MESSAGES.already });
    const n = await db.from("notification").select("status, manual_sent_by, provider_id").eq("id", ids.row).single();
    expect(n.data).toMatchObject({ status: "sent", manual_sent_by: ids.staff });
    expect(n.data!.provider_id).toMatch(/^https:\/\/wa\.me\/5543911112222\?text=/);
    const audit = await db.from("audit_log").select("action, actor_kind, actor_person_id, ip").eq("entity_id", ids.row);
    expect(audit.data).toEqual([{ action: "notification.whatsapp_sent", actor_kind: "staff", actor_person_id: ids.staff, ip: "203.0.113.7" }]);
    expect((await loadManualQueue(db, sp("2026-11-05T14:02:00"), 500)).some((r) => r.id === ids.row)).toBe(false);
  });
});
