"use server";
// C18 writes: the partner's brand (logo to Storage, color, footer toggle) and "Gerar fechamento com a marca do
// BPO" (render_close_bpo jobs for the clients with bpo.marca_propria on). Staff only, audited (A04).
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { bpoScreenEnabled, isHexColor, loadPartners, logoKind } from "@/lib/console/bpo";
import { requestMeta } from "@/lib/console/request";
import { requireConsole } from "@/lib/console/staff";
import { isEnabled } from "@/lib/flags";
import { enqueueDeps } from "@/lib/jobs/deps";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { adminClient } from "@/lib/supabase/admin";

const back = (id: string, msg?: string) => `/console/bpo?bpo=${encodeURIComponent(id)}${msg ? `&aviso=${encodeURIComponent(msg)}` : ""}`;

async function partnerOrNotFound(id: string) {
  const db = adminClient();
  const partners = await loadPartners(db);
  if (!(await bpoScreenEnabled(partners))) redirect("/console");
  const p = partners.find((x) => x.record.id === id);
  if (!p) redirect("/console/bpo");
  return { db, p };
}

export async function saveBrandAction(form: FormData): Promise<void> {
  const staff = await requireConsole("clients");
  const { db, p } = await partnerOrNotFound(String(form.get("bpo") ?? ""));
  const color = String(form.get("cor") ?? "").trim();
  // Not drawn: refusals said in the drawings' voice.
  if (!isHexColor(color)) redirect(back(p.record.id, "Cor no formato #1351B4."));
  const patch: { primary_color: string; show_powered_by: boolean; logo_path?: string } = { primary_color: color.toUpperCase(), show_powered_by: form.get("rodape") === "on" };
  const logo = form.get("logo");
  if (logo instanceof File && logo.size > 0) {
    const bytes = new Uint8Array(await logo.arrayBuffer());
    const kind = logoKind(logo.name, bytes);
    if (!kind) redirect(back(p.record.id, "Logo em PNG ou SVG, até 512 KB."));
    const path = `${p.record.id}/logo.${kind}`;
    const up = await db.storage.from("bpo").upload(path, bytes, { contentType: kind === "png" ? "image/png" : "image/svg+xml", upsert: true });
    if (up.error) throw new Error(up.error.message);
    patch.logo_path = `bpo/${path}`;
  }
  const { error } = await db.from("bpo_partner").update(patch).eq("id", p.record.id);
  if (error) throw new Error(error.message);
  const meta = await requestMeta();
  const { error: auditError } = await db.from("audit_log").insert({
    actor_person_id: staff.personId,
    actor_kind: "staff",
    action: "bpo_partner.brand",
    entity: "bpo_partner",
    entity_id: p.record.id,
    before: { primary_color: p.record.primary_color, show_powered_by: p.record.show_powered_by, logo_path: p.record.logo_path },
    after: patch,
    ip: meta.ip,
    user_agent: meta.userAgent,
  });
  if (auditError) throw new Error(auditError.message);
  revalidatePath("/console/bpo");
  redirect(back(p.record.id, "Marca salva."));
}

export async function generateBrandedAction(form: FormData): Promise<void> {
  const staff = await requireConsole("clients");
  const { db, p } = await partnerOrNotFound(String(form.get("bpo") ?? ""));
  let queued = 0;
  const meta = await requestMeta();
  for (const c of p.clients) {
    if (!(await isEnabled("bpo.marca_propria", c.accountId))) continue;
    const { data: close } = await db
      .from("close_period")
      .select("id, month")
      .eq("account_id", c.accountId)
      .is("kitchen_id", null)
      .in("status", ["computed", "delivered"])
      .order("month", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!close) continue;
    const job = await enqueueJob(enqueueDeps(), {
      type: "render_close_bpo",
      payload: { close_period_id: close.id, bpo_partner_id: p.record.id },
      accountId: c.accountId,
      // A brand change makes a new PDF; the same brand twice while queued is one job.
      dedupeKey: `render_close_bpo:${p.record.id}:${close.id}:${p.record.updated_at}`,
    });
    await db.from("audit_log").insert({
      actor_person_id: staff.personId,
      actor_kind: "staff",
      account_id: c.accountId,
      action: "close_period.render_bpo",
      entity: "close_period",
      entity_id: close.id,
      after: { bpo_partner_id: p.record.id, job_id: job.jobId },
      ip: meta.ip,
      user_agent: meta.userAgent,
    });
    queued++;
  }
  revalidatePath("/console/bpo");
  redirect(back(p.record.id, queued ? `${queued === 1 ? "1 fechamento" : `${queued} fechamentos`} na fila com a marca do ${p.record.name}.` : "Nenhum fechamento pronto nos clientes deste BPO."));
}
