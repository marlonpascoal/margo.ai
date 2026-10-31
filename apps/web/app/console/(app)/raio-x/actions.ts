"use server";
// M1 server actions (C02 to C06). Every one re-checks the console role (requireConsole, 404 otherwise) and
// the m1.raio_x flag for the X-ray's account (404 when off, A05), then writes through an audited SQL
// function (lib/xray/commands.ts, A04).
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { requireFlag } from "@/lib/flags";
import { requestMeta } from "@/lib/console/request";
import { requireConsole } from "@/lib/console/staff";
import { adminClient } from "@/lib/supabase/admin";
import * as cmd from "@/lib/xray/commands";
import { accountOfStore, xrayDeps } from "@/lib/xray/deps";
import { parseHours } from "@/lib/xray/format";
import { storeIdFromUrl } from "@/lib/xray/ifood-url";
import { XRAY_MESSAGES } from "@/lib/xray/labels";
import { isUuid, loadXrayHead, lookupStore, type XrayHead } from "@/lib/xray/load";

const text = (form: FormData, name: string) => String(form.get(name) ?? "");

async function actor(): Promise<cmd.Actor> {
  const staff = await requireConsole("clients");
  return { personId: staff.personId, ...(await requestMeta()) };
}

/** The X-ray named in the form, after the role and flag checks. */
async function xrayFor(form: FormData): Promise<{ a: cmd.Actor; x: XrayHead }> {
  const a = await actor();
  const x = await loadXrayHead(adminClient(), text(form, "xray"));
  if (!x) notFound();
  await requireFlag("m1.raio_x", x.accountId);
  return { a, x };
}

const base = (id: string) => `/console/raio-x/${id}`;

// C02 ---------------------------------------------------------------------------------------------

export type StoreLookup = { state: "invalid" } | { state: "unknown" } | { state: "found"; name: string; area: string | null; category: string | null };

/** C02 "Loja encontrada" after paste: only what the public catalog already has; no request to iFood. */
export async function lookupStoreAction(url: string): Promise<StoreLookup> {
  await actor();
  await requireFlag("m1.raio_x", null);
  const id = storeIdFromUrl(url);
  if (!id) return { state: "invalid" };
  const s = await lookupStore(adminClient(), id);
  return s?.name ? { state: "found", name: s.name, area: s.area, category: s.category } : { state: "unknown" };
}

export type CreateState = { message: string | null };

export async function createXrayAction(_prev: CreateState, form: FormData): Promise<CreateState> {
  const a = await actor();
  await requireFlag("m1.raio_x", null);
  const r = await cmd.createXray(
    xrayDeps(),
    a,
    {
      url: text(form, "url"),
      radiusKm: Number(text(form, "raio")),
      category: text(form, "categorias"),
      excludeClosed: form.get("fechadas") === "on",
      excludeChains: form.get("redes") === "on",
      sameNeighborhoodOnly: form.get("bairro") === "on",
    },
    accountOfStore,
  );
  if (!r.ok) return { message: r.field === "url" ? XRAY_MESSAGES.invalidUrl : XRAY_MESSAGES.invalidForm };
  redirect(`${base(r.xrayId)}/vizinhanca`);
}

// C03 ---------------------------------------------------------------------------------------------

export async function toggleStoreAction(xrayId: string, xrayStoreId: string, included: boolean): Promise<void> {
  const form = new FormData();
  form.set("xray", xrayId);
  const { a, x } = await xrayFor(form);
  if (!isUuid(xrayStoreId)) notFound();
  await cmd.setStoreIncluded(xrayDeps(), a, xrayStoreId, included);
  revalidatePath(`${base(x.id)}/vizinhanca`);
}

export async function confirmStoresAction(form: FormData): Promise<void> {
  const { a, x } = await xrayFor(form);
  await cmd.confirmStores(xrayDeps(), a, x.id, x.accountId);
  redirect(`${base(x.id)}/pareamento`);
}

// C04 ---------------------------------------------------------------------------------------------

export async function reviewItemAction(form: FormData): Promise<void> {
  const { a, x } = await xrayFor(form);
  const item = text(form, "item");
  if (!isUuid(item)) notFound();
  await cmd.reviewItem(xrayDeps(), a, item, form.getAll("pair").map(String).filter(isUuid));
  revalidatePath(`${base(x.id)}/pareamento`);
}

export async function skipItemAction(form: FormData): Promise<void> {
  const { a, x } = await xrayFor(form);
  const item = text(form, "item");
  if (!isUuid(item)) notFound();
  await cmd.setItemSkipped(xrayDeps(), a, item, text(form, "skipped") === "true");
  revalidatePath(`${base(x.id)}/pareamento`);
}

export async function calculateAction(form: FormData): Promise<void> {
  const { a, x } = await xrayFor(form);
  await cmd.calculate(xrayDeps(), a, x.id, x.accountId);
  redirect(base(x.id));
}

// C05, C06 ----------------------------------------------------------------------------------------

export async function prepareDeliveryAction(form: FormData): Promise<void> {
  const { a, x } = await xrayFor(form);
  await cmd.prepareDelivery(xrayDeps(), a, x.id, x.accountId);
  redirect(`${base(x.id)}/entrega`);
}

/** "Enviar pelo WhatsApp": the page opens click-to-chat itself; this records the delivery. */
export async function deliverAction(form: FormData): Promise<void> {
  const { a, x } = await xrayFor(form);
  await cmd.markDelivered(xrayDeps(), a, x.id, text(form, "mensagem"));
  revalidatePath(`${base(x.id)}/entrega`);
}

export type HoursState = { message: string | null };

export async function saveHoursAction(_prev: HoursState, form: FormData): Promise<HoursState> {
  const { a, x } = await xrayFor(form);
  const minutes: Record<string, number> = {};
  for (const step of ["vizinhanca", "pareamento", "entrega"]) {
    const raw = text(form, step).trim();
    if (!raw) continue;
    const m = parseHours(raw);
    if (m === null) return { message: XRAY_MESSAGES.invalidHours };
    minutes[step] = m;
  }
  await cmd.saveMinutes(xrayDeps(), a, x.id, minutes);
  redirect("/console");
}
