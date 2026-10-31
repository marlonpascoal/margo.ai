// C21 Alertas (design/C21-Alertas.dc.html, 04 §10): the open team alerts, as drawn. Reading only;
// "resolver" goes through lib/notify/alerts.ts resolveAlert (staff, resolved_by, audit_log).
import { TIME_ZONE, dayMonth } from "@/lib/format";
import { notifiedViaLabel, SEVERITY_LABEL } from "@/lib/notify/alerts";
import type { AlertSeverity } from "@/lib/notify/store";
import type { Db } from "@/lib/supabase/admin";

export interface AlertRecord {
  id: string;
  severity: AlertSeverity;
  title: string;
  account_id: string | null;
  link: string | null;
  notified_via: string[];
  opened_at: string;
}

export interface AlertRow {
  id: string;
  severity: AlertSeverity;
  severityLabel: string;
  title: string;
  /** "Grupo Exemplo (G-02)"; empty when the alert has no client. */
  client: string;
  since: string;
  via: string;
  action: { label: string; href: string } | null;
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { urgente: 0, medio: 1, baixo: 2 };

const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, dateStyle: "short" }).format(d);
const hourMinute = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

/** "Desde": "hoje 06:04" for today in São Paulo, else "27/out". */
export function sinceLabel(openedAt: Date, now: Date): string {
  return dayKey(openedAt) === dayKey(now) ? `hoje ${hourMinute(openedAt)}` : dayMonth(openedAt);
}

/** "Ação" link text, from the screen the alert links to (labels from the drawing). */
export function actionLabel(link: string): string {
  if (/\/corrigir$/.test(link)) return "corrigir";
  if (/\/importacoes$/.test(link)) return "ver importação";
  if (/\/assinaturas$/.test(link)) return "ver assinatura";
  if (/\/contestacoes$/.test(link)) return "ver contestação";
  if (/\/estrutura$/.test(link)) return "vincular";
  return "abrir";
}

export function buildAlertRows(alerts: AlertRecord[], accounts: Map<string, { code: string; name: string }>, now: Date): AlertRow[] {
  return [...alerts]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.opened_at.localeCompare(b.opened_at) || a.id.localeCompare(b.id))
    .map((a) => {
      const acc = a.account_id ? accounts.get(a.account_id) : undefined;
      return {
        id: a.id,
        severity: a.severity,
        severityLabel: SEVERITY_LABEL[a.severity],
        title: a.title,
        client: acc ? `${acc.name} (${acc.code})` : "",
        since: sinceLabel(new Date(a.opened_at), now),
        via: notifiedViaLabel(a.notified_via),
        action: a.link ? { label: actionLabel(a.link), href: a.link } : null,
      };
    });
}

/** Service-role read, after requireConsole("clients"). `synthetic`: show "dados fictícios". */
export async function loadOpenAlerts(db: Db, now: Date): Promise<{ rows: AlertRow[]; synthetic: boolean }> {
  const { data, error } = await db
    .from("alert")
    .select("id, severity, title, account_id, link, notified_via, opened_at, account(code, name, is_synthetic)")
    .is("resolved_at", null);
  if (error) throw new Error(error.message);
  const accounts = new Map<string, { code: string; name: string }>();
  let synthetic = false;
  for (const a of data ?? []) {
    if (a.account_id && a.account) {
      accounts.set(a.account_id, a.account);
      synthetic ||= a.account.is_synthetic;
    }
  }
  return { rows: buildAlertRows(data ?? [], accounts, now), synthetic };
}
