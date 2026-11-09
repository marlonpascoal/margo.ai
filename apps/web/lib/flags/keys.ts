// Feature flag keys and the server setting that picks their environment (04 §6, D34).
import type { Database } from "@margoai/contracts";

/** The 18 keys of 04 §6 plus m1.portal (PROVISIONAL, docs/m1-owner-journey-draft.md, 20261230000001_m1_monitor.sql) and the
 * X-ray-only launch screen flags portal.inicio, portal.lojas, conta.plano (20261231000005) and m1.oportunidades_ia
 * (P23 AI opportunities, 20261231000007), as seeded in supabase/migrations/20261031000003_reference_data.sql,
 * 20261211000001_m3_custo_flag.sql (m3.custo), 20261212000001_competitor_xray_limit.sql (m1.concorrente) and
 * 20261220000001_extract_schema.sql (m1.extracao). */
export const FLAG_KEYS = [
  "m1.raio_x",
  "m1.concorrente",
  "m1.extracao",
  "m1.portal",
  "m1.oportunidades_ia",
  "m1.comparacao_faixa",
  "m1.captura_manual",
  "m2.ifood_api",
  "m2.extensao_chrome",
  "m2.arquivo_99food",
  "m2.arquivo_ifood",
  "m2.contestacao",
  "m3.notas_xml",
  "m3.nfce_qr_auto",
  "m3.depara_ia",
  "m3.custo",
  "conta.multi_cozinha",
  "conta.pessoas",
  "bpo.marca_propria",
  "l.painel_dono",
  "l.aprovacao_cupom",
  "auth.whatsapp_code",
  "portal.inicio",
  "portal.lojas",
  "conta.plano",
] as const;

export type FlagKey = (typeof FLAG_KEYS)[number];
export type FlagEnv = Database["public"]["Enums"]["flag_env"];
export const PLAN_CODES = ["raio_x", "lucro", "rede"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const isFlagKey = (value: unknown): value is FlagKey => (FLAG_KEYS as readonly unknown[]).includes(value);
export const isPlanCode = (value: unknown): value is PlanCode => (PLAN_CODES as readonly unknown[]).includes(value);

/** 04 §6: sandbox and production keep separate values. Server setting MARGO_FLAG_ENV, default sandbox. */
export function flagEnv(value: string | undefined = process.env.MARGO_FLAG_ENV): FlagEnv {
  if (value === undefined || value === "") return "sandbox";
  if (value === "sandbox" || value === "production") return value;
  throw new Error(`MARGO_FLAG_ENV must be sandbox or production, got ${value}`);
}
