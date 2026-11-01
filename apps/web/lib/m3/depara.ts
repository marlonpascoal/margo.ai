// C11 De-para de insumos (design/C11-Depara.dc.html, 05 §A, D14). Copy verbatim from the drawing.
// One row per invoice text (description, NCM, unit): what it became in the catalog, how, and its price.
// D14: a suggestion counts in no cost until a founder confirms it; confirming goes through
// public.confirm_ingredient_match, which writes the CST-01 price of every line of that text.
import type { Database } from "@margoai/contracts";
import { audit, type M2Account } from "@/lib/m2/account";
import type { Db } from "@/lib/supabase/admin";
import { linePricePerBase, unitPriceLabel, type BaseUnit } from "./format";

type Method = Database["public"]["Enums"]["match_method"];
type Status = Database["public"]["Enums"]["match_status"];

export interface LineRecord {
  id: string;
  description: string;
  ncm: string | null;
  unit: string;
  qty: number;
  total_cents: number;
  issued_at: string;
  matches: MatchRecord[];
}

export interface MatchRecord {
  id: string;
  ingredient_id: string;
  ingredient: string;
  base_unit: BaseUnit;
  method: Method;
  status: Status;
  conversion_factor: number | null;
  confirmed_by: string | null;
  /** C11 "Como casou" of a rule match: "texto + NCM 0201" (ingredient_match.rule_note). */
  rule_note: string | null;
}

export type RowState = "auto" | "person" | "suggested" | "none";

export interface DeparaRow {
  key: string;
  description: string;
  ncm: string | null;
  unit: string;
  ingredient: string;
  ingredientId: string | null;
  how: string;
  price: string;
  state: RowState;
  spendCents: number;
  lineIds: string[];
  needsConversion: boolean;
}

export interface Shares {
  auto: number;
  ai: number;
  none: number;
}

/** C11 "Como casou": "código de barras", "regra: texto + NCM 0201", "regra: texto + unidade", "sugestão da IA". */
export function howLabel(m: Pick<MatchRecord, "method" | "rule_note">): string {
  if (m.method === "gtin") return "código de barras";
  if (m.method === "ai") return "sugestão da IA";
  if (m.method === "manual") return "escolhido no console";
  return `regra: ${m.rule_note ?? "texto"}`;
}

const active = (l: LineRecord) => l.matches.find((m) => m.status === "confirmed") ?? l.matches.find((m) => m.status === "suggested") ?? null;

export const groupKey = (l: Pick<LineRecord, "description" | "ncm" | "unit">) => JSON.stringify([l.description, l.ncm ?? "", l.unit]);

function stateOf(m: MatchRecord | null): RowState {
  if (!m) return "none";
  if (m.status === "suggested") return "suggested";
  return m.method === "gtin" || m.method === "rule" ? "auto" : "person";
}

const ORDER: Record<RowState, number> = { auto: 0, person: 1, suggested: 2, none: 3 };

/** Rows of C11: confirmed first, then suggestions, then lines without a pair; by spend within each. */
export function deparaRows(lines: LineRecord[]): DeparaRow[] {
  const groups = new Map<string, LineRecord[]>();
  for (const l of lines) {
    const k = groupKey(l);
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const rows: DeparaRow[] = [];
  for (const [key, ls] of groups) {
    const latest = [...ls].sort((a, b) => b.issued_at.localeCompare(a.issued_at))[0];
    const m = active(latest);
    const conv = m?.conversion_factor ?? null;
    rows.push({
      key,
      description: latest.description,
      ncm: latest.ncm,
      unit: latest.unit,
      ingredient: m?.ingredient ?? "sem par",
      ingredientId: m?.ingredient_id ?? null,
      how: m ? howLabel(m) : "",
      price: m && conv ? unitPriceLabel(linePricePerBase(latest.total_cents, latest.qty, conv), m.base_unit) : "",
      state: stateOf(m),
      spendCents: ls.reduce((s, l) => s + l.total_cents, 0),
      lineIds: ls.map((l) => l.id),
      needsConversion: !!m && m.status === "suggested" && !conv,
    });
  }
  return rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.spendCents - a.spendCents || a.description.localeCompare(b.description));
}

/** C11 cards, shares of invoice spend: matched without a person (GTIN or rule, confirmed), AI suggestion
 * waiting for confirmation, no pair. Whole percent, half up. */
export function spendShares(lines: LineRecord[]): Shares {
  let total = 0;
  let auto = 0;
  let ai = 0;
  let none = 0;
  for (const l of lines) {
    total += l.total_cents;
    const m = active(l);
    if (!m) none += l.total_cents;
    else if (m.status === "confirmed" && (m.method === "gtin" || m.method === "rule")) auto += l.total_cents;
    else if (m.status === "suggested" && m.method === "ai") ai += l.total_cents;
  }
  const pct = (v: number) => (total === 0 ? 0 : Math.round((v * 100) / total));
  return { auto: pct(auto), ai: pct(ai), none: pct(none) };
}

// Loading ---------------------------------------------------------------------------------------------

export async function loadLines(db: Db, accountId: string): Promise<LineRecord[]> {
  const { data, error } = await db
    .from("invoice_line")
    .select(
      "id, description, ncm, unit, qty, total_cents, invoice!inner(issued_at), ingredient_match(id, ingredient_id, method, status, conversion_factor, confirmed_by, rule_note, ingredient(name, base_unit))",
    )
    .eq("account_id", accountId)
    .limit(20000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    description: r.description,
    ncm: r.ncm,
    unit: r.unit,
    qty: Number(r.qty),
    total_cents: r.total_cents,
    issued_at: r.invoice.issued_at,
    matches: r.ingredient_match.map((m) => ({
      id: m.id,
      ingredient_id: m.ingredient_id,
      ingredient: m.ingredient.name,
      base_unit: m.ingredient.base_unit,
      method: m.method,
      status: m.status,
      conversion_factor: m.conversion_factor === null ? null : Number(m.conversion_factor),
      confirmed_by: m.confirmed_by,
      rule_note: m.rule_note,
    })),
  }));
}

export interface CatalogOption {
  id: string;
  name: string;
}

export async function loadCatalog(db: Db): Promise<CatalogOption[]> {
  const { data, error } = await db.from("ingredient").select("id, name").order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Global rules flagged for a founder (D14 step 2, Marlon 31/out) ----------------------------------------
// A learned global rule only suggests until m3.global_rule_min_accounts accounts agree. When a person picks
// another ingredient for a line it matches, worker-match flags it (disputed_at): it stays suggest-only and is
// listed in C11 until a founder marks it reviewed. Global rules carry no account data and no price.

export interface RuleRecord {
  id: string;
  keywords: string[];
  ncm_prefix: string | null;
  unit: string | null;
  ingredient: string;
  disputed_ingredient: string | null;
  disputed_at: string;
}

export interface FlaggedRuleRow {
  id: string;
  rule: string;
  ingredient: string;
  chosen: string;
}

/** A rule as a founder reads it: "CHED QJO · NCM 04063000 · PC". */
export function ruleText(r: Pick<RuleRecord, "keywords" | "ncm_prefix" | "unit">): string {
  return [r.keywords.join(" "), r.ncm_prefix ? `NCM ${r.ncm_prefix}` : null, r.unit].filter(Boolean).join(" · ");
}

/** C11 "Regras gerais em revisão": newest flag first. */
export function flaggedRuleRows(rules: RuleRecord[]): FlaggedRuleRow[] {
  return [...rules]
    .sort((a, b) => b.disputed_at.localeCompare(a.disputed_at))
    .map((r) => ({ id: r.id, rule: ruleText(r), ingredient: r.ingredient, chosen: r.disputed_ingredient ?? "outro insumo" }));
}

export async function loadFlaggedRules(db: Db): Promise<RuleRecord[]> {
  const { data, error } = await db
    .from("ingredient_rule")
    .select("id, keywords, ncm_prefix, unit, disputed_at, ingredient:ingredient!ingredient_rule_ingredient_id_fkey(name), disputed:ingredient!ingredient_rule_disputed_ingredient_id_fkey(name)")
    .eq("source", "confirmation")
    .not("disputed_at", "is", null)
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    keywords: r.keywords,
    ncm_prefix: r.ncm_prefix,
    unit: r.unit,
    ingredient: r.ingredient.name,
    disputed_ingredient: r.disputed?.name ?? null,
    disputed_at: r.disputed_at!,
  }));
}

// Writes (audited, A04) -------------------------------------------------------------------------------

export class DeparaRefused extends Error {}

type Meta = { ip: string | null; userAgent: string | null };

async function groupLines(db: Db, accountId: string, key: string): Promise<LineRecord[]> {
  return (await loadLines(db, accountId)).filter((l) => groupKey(l) === key);
}

const parseConversion = (raw: string | null): number | null => {
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** "Confirmar": the suggested ingredient becomes the confirmed match of every line with this text. */
export async function confirmGroup(db: Db, account: M2Account, staffId: string, key: string, conversionRaw: string | null, meta: Meta): Promise<number> {
  const lines = await groupLines(db, account.id, key);
  const conversion = parseConversion(conversionRaw);
  const done: string[] = [];
  for (const l of lines) {
    const m = l.matches.find((x) => x.status === "suggested");
    if (!m) continue;
    if (!m.conversion_factor && !conversion) throw new DeparaRefused("Informe quantas unidades do insumo vêm em uma unidade da nota.");
    const { error } = await db.rpc("confirm_ingredient_match", { p_match: m.id, p_person: staffId, p_conversion: conversion ?? undefined });
    if (error) throw new Error(error.message);
    done.push(m.id);
  }
  if (done.length) {
    await audit(db, { actor: staffId, accountId: account.id, action: "ingredient_match.confirm", entity: "ingredient_match", entityId: done[0], after: { matches: done, conversion }, meta });
  }
  return done.length;
}

/** "Recusar sugestão": the suggestion is rejected; no price, no cost, nothing else changes (D02). */
export async function rejectGroup(db: Db, account: M2Account, staffId: string, key: string, meta: Meta): Promise<number> {
  const ids = (await groupLines(db, account.id, key)).flatMap((l) => l.matches.filter((m) => m.status === "suggested").map((m) => m.id));
  if (!ids.length) return 0;
  const { error } = await db.from("ingredient_match").update({ status: "rejected" }).in("id", ids);
  if (error) throw new Error(error.message);
  await audit(db, { actor: staffId, accountId: account.id, action: "ingredient_match.reject", entity: "ingredient_match", entityId: ids[0], after: { matches: ids }, meta });
  return ids.length;
}

export interface NewIngredient {
  name: string;
  category: string;
  baseUnit: BaseUnit;
}

/** "Trocar": a catalog ingredient (or a new one) chosen by a founder, confirmed on every line of the text. */
export async function swapGroup(
  db: Db,
  account: M2Account,
  staffId: string,
  key: string,
  choice: { ingredientId: string } | NewIngredient,
  conversionRaw: string | null,
  meta: Meta,
): Promise<number> {
  let ingredientId: string;
  if ("ingredientId" in choice) {
    ingredientId = choice.ingredientId;
  } else {
    const name = choice.name.trim();
    if (!name || !choice.category.trim()) throw new DeparaRefused("Dê nome e categoria ao insumo novo.");
    const { data, error } = await db.from("ingredient").insert({ name, category: choice.category.trim(), base_unit: choice.baseUnit }).select("id").single();
    if (error) throw new DeparaRefused(error.code === "23505" ? "Já existe um insumo com esse nome no catálogo." : error.message);
    ingredientId = data.id;
    await audit(db, { actor: staffId, accountId: account.id, action: "ingredient.create", entity: "ingredient", entityId: ingredientId, after: { name, category: choice.category, base_unit: choice.baseUnit }, meta });
  }
  const conversion = parseConversion(conversionRaw);
  if (!conversion) throw new DeparaRefused("Informe quantas unidades do insumo vêm em uma unidade da nota.");
  const lines = await groupLines(db, account.id, key);
  const done: string[] = [];
  for (const l of lines) {
    const { data, error } = await db
      .from("ingredient_match")
      .upsert(
        { account_id: account.id, invoice_line_id: l.id, ingredient_id: ingredientId, method: "manual", status: "suggested", conversion_factor: conversion },
        { onConflict: "invoice_line_id,ingredient_id" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const r = await db.rpc("confirm_ingredient_match", { p_match: data.id, p_person: staffId, p_conversion: conversion });
    if (r.error) throw new Error(r.error.message);
    done.push(data.id);
  }
  if (done.length) {
    await audit(db, { actor: staffId, accountId: account.id, action: "ingredient_match.swap", entity: "ingredient_match", entityId: done[0], after: { matches: done, ingredient_id: ingredientId, conversion }, meta });
  }
  return done.length;
}

/** "Revisada": a founder clears the flag of a disputed global rule. It stays suggest-only; worker-match
 * promotes it again only when m3.global_rule_min_accounts accounts hold it (D14). */
export async function reviewRule(db: Db, account: M2Account, staffId: string, ruleId: string, meta: Meta): Promise<void> {
  const before = await db.from("ingredient_rule").select("disputed_at, disputed_ingredient_id").eq("id", ruleId).eq("source", "confirmation").maybeSingle();
  if (before.error) throw new Error(before.error.message);
  if (!before.data?.disputed_at) throw new DeparaRefused("Essa regra já foi revisada.");
  const { error } = await db.from("ingredient_rule").update({ disputed_at: null, disputed_ingredient_id: null }).eq("id", ruleId);
  if (error) throw new Error(error.message);
  await audit(db, {
    actor: staffId,
    accountId: account.id,
    action: "ingredient_rule.review",
    entity: "ingredient_rule",
    entityId: ruleId,
    before: before.data,
    after: { disputed_at: null, disputed_ingredient_id: null },
    meta,
  });
}
