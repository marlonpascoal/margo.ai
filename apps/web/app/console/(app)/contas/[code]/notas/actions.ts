"use server";
// C10 writes: accountant zip (invoice_import + job), a single receipt key or QR link, its typed item lines.
// Staff only, flag m3.notas_xml, audit_log (A04). C06: a real account needs the owner's authorization.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFlag } from "@/lib/flags";
import { requestMeta } from "@/lib/console/request";
import { requireConsole } from "@/lib/console/staff";
import { accountByCode } from "@/lib/m2/account";
import { addKeyedLine, NotasRefused, saveKey, uploadZip } from "@/lib/m3/notas";
import { adminClient } from "@/lib/supabase/admin";

const back = (code: string, q: Record<string, string | undefined> = {}) => {
  const p = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1]));
  const s = p.toString();
  return `/console/contas/${encodeURIComponent(code)}/notas${s ? `?${s}` : ""}`;
};
const text = (form: FormData, k: string) => String(form.get(k) ?? "").trim();

async function context(form: FormData) {
  const staff = await requireConsole("clients");
  const db = adminClient();
  const account = await accountByCode(db, text(form, "conta"));
  await requireFlag("m3.notas_xml", account.id);
  return { staff, db, account, meta: await requestMeta() };
}

export async function uploadZipAction(form: FormData): Promise<void> {
  const { staff, db, account, meta } = await context(form);
  const file = form.get("zip");
  if (!(file instanceof File) || file.size === 0) redirect(back(account.code, { aviso: "Escolha o .zip do contador." }));
  let aviso: string | undefined;
  try {
    await uploadZip(db, account, staff.personId, file, meta);
  } catch (e) {
    if (!(e instanceof NotasRefused)) throw e;
    aviso = e.message;
  }
  revalidatePath(back(account.code));
  redirect(back(account.code, { aviso }));
}

export async function saveKeyAction(form: FormData): Promise<void> {
  const { staff, db, account, meta } = await context(form);
  let aviso: string | undefined;
  let nota: string | undefined;
  try {
    nota = await saveKey(db, account, staff.personId, text(form, "chave"), meta);
  } catch (e) {
    if (!(e instanceof NotasRefused)) throw e;
    aviso = e.message;
  }
  revalidatePath(back(account.code));
  redirect(back(account.code, { aviso, nota }));
}

export async function addLineAction(form: FormData): Promise<void> {
  const { staff, db, account, meta } = await context(form);
  const nota = text(form, "nota");
  let aviso: string | undefined;
  try {
    await addKeyedLine(
      db,
      account,
      staff.personId,
      nota,
      { issuedOn: text(form, "data"), description: text(form, "descricao"), unit: text(form, "unidade"), qty: text(form, "quantidade"), total: text(form, "valor") },
      meta,
    );
  } catch (e) {
    if (!(e instanceof NotasRefused)) throw e;
    aviso = e.message;
  }
  revalidatePath(back(account.code));
  redirect(back(account.code, { aviso, nota }));
}
