// P16, W08 Notificações: the 10 notices of 04 §9 with who and when, as drawn, and this person's choice
// (E05: their preference, else the default; locked notices always by e-mail).
import { closeReadyEmail, type EmailContent } from "@/emails";
import { CHANNEL_LABEL, CHANNEL_ORDER } from "@/lib/m2/format";
import { effectivePref, type NoticeType, type Role } from "@/lib/notify/plan";
import type { NoticeCode } from "@/lib/notify/templates";
import type { Db } from "@/lib/supabase/admin";
import { homeNumbers, type HomeDiff, type HomeLine } from "./home";

/** W08 "Quando" and the profile line; P16 uses shorter names on phone. Order as drawn. */
export const NOTICE_COPY: [NoticeCode, { phone: string; who: string; when: string }][] = [
  ["close_ready", { phone: "Fechamento do mês pronto", who: "Dono, Financeiro", when: "dia 5 de cada mês" }],
  ["new_difference", { phone: "Diferença nova no repasse", who: "Dono, Financeiro", when: "assim que a importação encontra" }],
  ["deadline_soon", { phone: "Prazo de contestação chegando", who: "Dono, Financeiro", when: "3 dias antes do prazo" }],
  ["credit_confirmed", { phone: "Crédito confirmado", who: "Dono, Financeiro", when: "quando o valor aparece" }],
  ["data_stale", { phone: "Dados parados", who: "Dono", when: "extensão sem enviar há 3 dias, ou autorização do iFood revogada" }],
  ["invoices_missing", { phone: "Notas faltando", who: "Dono, Financeiro", when: "quando falta preço de algum insumo do top 20" }],
  ["weekly_summary", { phone: "Resumo da semana", who: "todos os perfis", when: "segunda, 8h" }],
  ["trial_ending", { phone: "Teste grátis acabando", who: "Dono", when: "3 dias antes e no dia" }],
  ["billing_result", { phone: "Cobrança aprovada ou recusada", who: "Dono", when: "a cada cobrança do Asaas" }],
  ["security_event", { phone: "Login em aparelho novo", who: "Dono", when: "na hora" }],
];

export interface NoticeRow {
  code: string;
  name: string;
  phoneName: string;
  who: string;
  when: string;
  email: boolean;
  whatsapp: boolean;
  locked: boolean;
}

/** E05: rows in drawn order, only the notices this profile can receive. */
export function noticeRows(types: NoticeType[], prefs: Map<string, { email: boolean; whatsapp: boolean }>, role: Role): NoticeRow[] {
  const byCode = new Map(types.map((t) => [t.code, t]));
  return NOTICE_COPY.flatMap(([code, copy]) => {
    const t = byCode.get(code);
    if (!t || !t.audienceRoles.includes(role)) return [];
    const p = effectivePref(t, prefs.get(code) ?? null);
    return [{ code, name: t.name, phoneName: copy.phone, who: copy.who, when: copy.when, email: p.email, whatsapp: p.whatsapp, locked: t.emailLocked }];
  });
}

export async function loadNoticeRows(db: Db, personId: string, accountId: string, role: Role): Promise<NoticeRow[]> {
  const [{ data: types, error }, { data: prefs }] = await Promise.all([
    db.from("notice_type").select("code, name, audience_roles, email_locked, default_email, default_whatsapp"),
    db.from("notice_pref").select("notice_code, email, whatsapp").eq("person_id", personId).eq("account_id", accountId),
  ]);
  if (error) throw new Error(error.message);
  return noticeRows(
    (types ?? []).map((t) => ({
      code: t.code,
      name: t.name,
      audienceRoles: t.audience_roles as Role[],
      emailLocked: t.email_locked,
      defaultEmail: t.default_email,
      defaultWhatsapp: t.default_whatsapp,
    })),
    new Map((prefs ?? []).map((p) => [p.notice_code, { email: p.email, whatsapp: p.whatsapp }])),
    role,
  );
}

/**
 * W08 "Ver exemplo de e-mail": the E01 template (apps/web/emails) with this person's own numbers, scoped to
 * their kitchens (A03): REP-01 sold, REP-02 received, DIF to contest, as W01 shows them.
 */
export function closeReadyExample(accountName: string, month: string, lines: HomeLine[], diffs: HomeDiff[]): EmailContent {
  const n = homeNumbers(lines, diffs, null);
  return closeReadyEmail({
    accountName,
    month,
    kitchens: new Set(lines.map((l) => l.kitchenId).filter(Boolean)).size,
    channels: CHANNEL_ORDER.filter((c) => lines.some((l) => l.channel === c)).map((c) => CHANNEL_LABEL[c]),
    grossCents: n.soldCents,
    payoutCents: n.receivedCents,
    leftCents: null,
    wrongCents: n.wrongCents,
  });
}
