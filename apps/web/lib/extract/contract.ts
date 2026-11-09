// The extractor contract (docs/extract-api.md, D47c): an allowlist of fields for what comes back from
// /api/extract/result. Anything not listed is dropped and named in the answer, so raw HTML, customer reviews
// or a self-declared last_seen_open_at never reach a copy. Pure: no database, no clock except the argument.
/** Transitory or permanent is the server's call, per reason, in rule_param m1.extract_retry_reason_* (docs/extract-api.md). */
export const FAIL_REASONS = ["blocked", "not_found", "parse_error", "timeout", "network", "other"] as const;
export type FailReason = (typeof FAIL_REASONS)[number];
export const isFailReason = (v: unknown): v is FailReason => (FAIL_REASONS as readonly unknown[]).includes(v);

export type ExtractKind = "discover" | "capture";

export interface ExtractCopy {
  external_id: string;
  content: Record<string, unknown>;
}

export type ParsedResult =
  | { ok: true; source: string; collectedAt: string; copies: ExtractCopy[]; dropped: string[] }
  | { ok: false; errors: string[]; dropped: string[] };

type Rule = { required?: boolean; check: (v: unknown) => string | null };

const RAW_HTML = /<!doctype|<\s*(html|head|body|script)\b/i;

const text = (max: number) => (v: unknown) => {
  if (typeof v !== "string" || v.trim() === "") return "must be a non-empty string";
  if (v.length > max) return `longer than ${max} characters`;
  return RAW_HTML.test(v) ? "must not hold raw HTML" : null;
};
const httpsUrl = (v: unknown) => {
  const bad = text(2048)(v);
  if (bad) return bad;
  try {
    return new URL(v as string).protocol === "https:" ? null : "must be an https URL";
  } catch {
    return "must be an https URL";
  }
};
const number = (min: number, max: number) => (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? null : `must be a number from ${min} to ${max}`;
const cents = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? null : "must be an integer of centavos, 0 or more";
const count = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 2_147_483_647 ? null : "must be an integer, 0 or more";
const textList = (v: unknown) =>
  Array.isArray(v) && v.length <= 200 && v.every((s) => text(200)(s) === null) ? null : "must be an array of strings";
const bool = (v: unknown) => (typeof v === "boolean" ? null : "must be true or false");
const choiceList = (v: unknown) => (Array.isArray(v) && v.length <= 100 ? null : "must be an array");
const optionList = (v: unknown) =>
  Array.isArray(v) && v.length >= 1 && v.length <= 500 ? null : "must be an array with at least one option";
const unit = (v: unknown) => (v === "g" || v === "ml" || v === "un" || v === "pack" ? null : 'must be "g", "ml", "un" or "pack"');

const STORE: Record<string, Rule> = {
  external_id: { required: true, check: text(200) },
  url: { required: true, check: httpsUrl },
  slug: { check: text(500) },
  name: { check: text(300) },
  category: { check: text(200) },
  main_category_code: { check: text(50) },
  super_categories: { check: textList },
  rating: { check: number(0, 5) },
  rating_count: { check: count },
  address: { check: text(500) },
  area: { check: text(200) },
  lat: { check: number(-90, 90) },
  lng: { check: number(-180, 180) },
  is_open: { check: bool },
};

const DISCOVERED: Record<string, Rule> = {
  distance_km: { check: number(0, 20_000) },
  search_terms: { check: textList },
  taxonomies: { check: textList },
};

const ITEM: Record<string, Rule> = {
  external_item_id: { required: true, check: text(200) },
  name: { required: true, check: text(300) },
  description: { check: text(2000) },
  category: { check: text(200) },
  taxonomy_level1: { check: text(200) },
  taxonomy_level2: { check: text(200) },
  price_cents: { required: true, check: cents },
  original_price_cents: { check: cents },
  minimum_price_cents: { check: cents },
  unit: { check: unit },
  unit_qty: { check: number(0.01, 10_000_000) },
  choices: { check: choiceList },
  type: { check: text(50) },
};

const CHOICE: Record<string, Rule> = {
  name: { required: true, check: text(300) },
  min: { required: true, check: count },
  max: { required: true, check: count },
  options: { required: true, check: optionList },
};

const CHOICE_OPTION: Record<string, Rule> = {
  name: { required: true, check: text(300) },
  price_cents: { required: true, check: cents },
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

class Reader {
  errors: string[] = [];
  private droppedNames = new Set<string>();

  /** The allowlisted fields of one object. A null counts as absent. `dropAs` names dropped keys without indexes. */
  fields(at: string, dropAs: string, raw: unknown, rules: Record<string, Rule>): Record<string, unknown> | null {
    if (!isObject(raw)) {
      this.errors.push(`${at}: must be an object`);
      return null;
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      const rule = rules[key];
      if (!rule) {
        this.droppedNames.add(dropAs ? `${dropAs}.${key}` : key);
        continue;
      }
      if (value === null || value === undefined) continue;
      const problem = rule.check(value);
      if (problem) this.errors.push(`${at}.${key}: ${problem}`);
      else out[key] = value;
    }
    for (const [key, rule] of Object.entries(rules)) {
      if (rule.required && (raw[key] === null || raw[key] === undefined)) this.errors.push(`${at}.${key}: required`);
    }
    return out;
  }

  drop(name: string) {
    this.droppedNames.add(name);
  }

  get dropped(): string[] {
    return [...this.droppedNames].sort();
  }
}

function parseDiscover(r: Reader, raw: unknown, externalId: string | null): ExtractCopy[] {
  if (!isObject(raw)) {
    r.errors.push("discover: must be an object");
    return [];
  }
  for (const key of Object.keys(raw)) if (key !== "target" && key !== "stores") r.drop(`discover.${key}`);
  const target = r.fields("discover.target", "discover.target", raw.target, STORE);
  if (target && externalId && target.external_id !== undefined && target.external_id !== externalId) {
    r.errors.push("discover.target.external_id: is not the store this job asked for");
  }
  if (!Array.isArray(raw.stores)) {
    r.errors.push("discover.stores: must be an array");
    return [];
  }
  const copies: ExtractCopy[] = target ? [{ external_id: target.external_id as string, content: { kind: "discover_target", store: target } }] : [];
  raw.stores.forEach((entry, i) => {
    const all = r.fields(`discover.stores[${i}]`, "discover.stores[]", entry, { ...STORE, ...DISCOVERED });
    if (!all) return;
    const { distance_km, search_terms, taxonomies, ...store } = all;
    copies.push({
      external_id: store.external_id as string,
      content: { kind: "discover_store", store, distance_km, search_terms, taxonomies },
    });
  });
  return copies;
}

/** The allowlist goes down into each complement group and option, so nothing else in them reaches a copy. */
function parseChoices(r: Reader, at: string, groups: unknown[]): Record<string, unknown>[] {
  const dropAs = "capture.items[].choices[]";
  return groups.flatMap((raw, j) => {
    const here = `${at}.choices[${j}]`;
    const group = r.fields(here, dropAs, raw, CHOICE);
    if (!group) return [];
    if (typeof group.min === "number" && typeof group.max === "number" && group.min > group.max) {
      r.errors.push(`${here}: min is above max`);
    }
    if (Array.isArray(group.options)) {
      group.options = group.options.flatMap((o, k) => r.fields(`${here}.options[${k}]`, `${dropAs}.options[]`, o, CHOICE_OPTION) ?? []);
    }
    return [group];
  });
}

function parseCapture(r: Reader, raw: unknown, externalId: string | null): ExtractCopy[] {
  if (!isObject(raw)) {
    r.errors.push("capture: must be an object");
    return [];
  }
  for (const key of Object.keys(raw)) if (key !== "store" && key !== "items") r.drop(`capture.${key}`);
  const store = r.fields("capture.store", "capture.store", raw.store, STORE);
  if (store && externalId && store.external_id !== undefined && store.external_id !== externalId) {
    r.errors.push("capture.store.external_id: is not the store this job asked for");
  }
  // An empty list would mark the whole menu removed: a page that shows no item is a failure, not a capture.
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    r.errors.push("capture.items: must be an array with at least one item");
    return [];
  }
  const items: Record<string, unknown>[] = [];
  raw.items.forEach((entry, i) => {
    const item = r.fields(`capture.items[${i}]`, "capture.items[]", entry, ITEM);
    if (!item) return;
    // M1-03 cannot normalize a price by weight or volume without the quantity.
    if ((item.unit === "g" || item.unit === "ml") && item.unit_qty === undefined) {
      r.errors.push(`capture.items[${i}].unit_qty: required when unit is ${item.unit as string}`);
    }
    if (Array.isArray(item.choices)) item.choices = parseChoices(r, `capture.items[${i}]`, item.choices);
    items.push(item);
  });
  return store ? [{ external_id: store.external_id as string, content: { kind: "capture", store, items } }] : [];
}

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const ONE_DAY_MS = 86_400_000;

/** D47c: the allowlist. `externalId` is the store the job asked for. */
export function parseExtractResult(kind: ExtractKind, externalId: string | null, body: unknown, now: Date): ParsedResult {
  const r = new Reader();
  if (!isObject(body)) return { ok: false, errors: ["body: must be an object"], dropped: [] };
  for (const key of Object.keys(body)) {
    if (!["job_id", "source", "collected_at", "discover", "capture"].includes(key)) r.drop(key);
  }
  const source = text(50)(body.source) === null ? (body.source as string) : null;
  if (!source) r.errors.push("source: required");
  const at = body.collected_at;
  const when = typeof at === "string" && ISO_8601.test(at) ? new Date(at) : null;
  if (!when || Number.isNaN(when.getTime())) r.errors.push("collected_at: must be an ISO 8601 time with a zone");
  else if (when.getTime() > now.getTime() + ONE_DAY_MS) r.errors.push("collected_at: is in the future");

  const other = kind === "discover" ? "capture" : "discover";
  if (body[other] !== undefined) r.errors.push(`${other}: this job is a ${kind}`);
  let copies: ExtractCopy[] = [];
  if (body[kind] === undefined || body[kind] === null) r.errors.push(`${kind}: required`);
  else copies = kind === "discover" ? parseDiscover(r, body.discover, externalId) : parseCapture(r, body.capture, externalId);

  if (r.errors.length > 0) return { ok: false, errors: r.errors, dropped: r.dropped };
  return { ok: true, source: source!, collectedAt: when!.toISOString(), copies, dropped: r.dropped };
}
