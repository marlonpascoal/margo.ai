// B01: the extractor contract (docs/extract-api.md, D47c). Fixtures are SINTÉTICO.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractAuthorized } from "./server";
import { FAIL_REASONS, isFailReason, parseExtractResult } from "./contract";

const fixture = (name: string) =>
  JSON.parse(readFileSync(resolve(__dirname, "../../../../fixtures/m1/extract", name), "utf8")) as Record<string, never> & {
    discover: { target: Record<string, unknown>; stores: Record<string, unknown>[] };
    capture: { store: Record<string, unknown>; items: Record<string, unknown>[] };
  };
const NOW = new Date("2026-11-07T12:00:00Z");
const TARGET = "5e000000-0000-4000-8000-000000000001";
const STORE_A = "5e000000-0000-4000-8000-000000000002";

describe("B01 extract token", () => {
  it("B01_token_is_compared_and_a_missing_env_refuses_everything", () => {
    expect(extractAuthorized("Bearer abc", "abc")).toBe(true);
    expect(extractAuthorized("bearer abc", "abc")).toBe(true);
    expect(extractAuthorized("Bearer abd", "abc")).toBe(false);
    expect(extractAuthorized("Bearer abcd", "abc")).toBe(false);
    expect(extractAuthorized("abc", "abc")).toBe(false);
    expect(extractAuthorized(null, "abc")).toBe(false);
    expect(extractAuthorized("Bearer abc", undefined)).toBe(false);
    expect(extractAuthorized("Bearer ", "")).toBe(false);
  });
});

describe("B01 allowlist", () => {
  it("B01_discover_keeps_the_allowlist_and_lists_what_it_dropped", () => {
    const r = parseExtractResult("discover", TARGET, fixture("discover.json"), NOW);
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.source).toBe("scraper");
    expect(r.collectedAt).toBe("2026-10-31T13:00:00.000Z");
    expect(r.copies.map((c) => c.external_id)).toHaveLength(4);
    expect(r.dropped).toEqual(["_label", "discover.stores[].last_seen_open_at", "discover.stores[].raw_html", "discover.stores[].reviews"]);
    const text = JSON.stringify(r.copies);
    expect(text).not.toContain("<html");
    expect(text).not.toContain("comentário");
    expect(text).not.toContain("last_seen_open_at");
    expect(r.copies[0].content).toMatchObject({ kind: "discover_target", store: { address: "Rua Sintética, 100", is_open: true } });
    expect(r.copies[1].content).toMatchObject({ kind: "discover_store", distance_km: 1.2, search_terms: ["Lanches"], taxonomies: ["HAMBURGUERES"] });
    expect((r.copies[1].content.store as Record<string, unknown>).distance_km).toBeUndefined();
  });

  it("B01_capture_keeps_items_and_their_prices", () => {
    const r = parseExtractResult("capture", STORE_A, fixture("capture-store.json"), NOW);
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.copies).toHaveLength(1);
    expect(r.copies[0].content.items).toHaveLength(3);
    expect(r.dropped).toEqual(["_label"]);
  });

  it("B01_identical_content_does_not_depend_on_the_date", () => {
    const a = fixture("capture-store.json");
    const b = { ...fixture("capture-store.json"), collected_at: "2026-11-01T10:00:00-03:00" };
    const [ra, rb] = [parseExtractResult("capture", STORE_A, a, NOW), parseExtractResult("capture", STORE_A, b, NOW)];
    if (!ra.ok || !rb.ok) throw new Error("parse");
    expect(ra.copies).toEqual(rb.copies);
  });

  it("B01_missing_required_fields_are_listed", () => {
    const body = fixture("capture-store.json");
    delete body.capture.store.url;
    delete body.capture.items[0].name;
    delete body.capture.items[1].price_cents;
    const r = parseExtractResult("capture", STORE_A, body, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(["capture.store.url: required", "capture.items[0].name: required", "capture.items[1].price_cents: required"]);
  });

  it.each([
    ["price not an integer", (b: ReturnType<typeof fixture>) => (b.capture.items[0].price_cents = 10.5), "capture.items[0].price_cents"],
    ["unit outside the list", (b: ReturnType<typeof fixture>) => (b.capture.items[0].unit = "kg"), "capture.items[0].unit"],
    ["weight without quantity", (b: ReturnType<typeof fixture>) => (b.capture.items[2].unit_qty = null as never), "capture.items[2].unit_qty"],
    ["raw HTML in a known field", (b: ReturnType<typeof fixture>) => (b.capture.items[0].description = "<html><body>x</body></html>"), "capture.items[0].description"],
    ["no items", (b: ReturnType<typeof fixture>) => (b.capture.items = []), "capture.items"],
    ["http URL", (b: ReturnType<typeof fixture>) => (b.capture.store.url = "http://exemplo.test/x"), "capture.store.url"],
    ["another store", (b: ReturnType<typeof fixture>) => (b.capture.store.external_id = "outra"), "capture.store.external_id"],
  ])("B01_refuses_%s", (_name, change, path) => {
    const body = fixture("capture-store.json");
    change(body);
    const r = parseExtractResult("capture", STORE_A, body, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain(path);
  });

  it("B01_a_null_optional_field_counts_as_absent", () => {
    const body = fixture("capture-store.json");
    body.capture.store.lat = null as never;
    const r = parseExtractResult("capture", STORE_A, body, NOW);
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.copies[0].content.store).not.toHaveProperty("lat");
  });

  it("B01_body_kind_must_match_the_job", () => {
    const r = parseExtractResult("capture", STORE_A, fixture("discover.json"), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(["discover: this job is a capture", "capture: required"]);
  });

  it("B01_collected_at_needs_a_zone_and_cannot_be_in_the_future", () => {
    const body = fixture("capture-store.json");
    for (const at of ["2026-10-31", "2026-10-31T10:00:00", "ontem", "2026-11-09T10:00:00Z"]) {
      const r = parseExtractResult("capture", STORE_A, { ...body, collected_at: at }, NOW);
      expect(r.ok).toBe(false);
    }
  });
});

describe("M1 choices (complements)", () => {
  const CHOICE = { name: "Escolha a proteína", min: 1, max: 1, options: [{ name: "Frango sintético", price_cents: 0 }, { name: "Carne sintética", price_cents: 500 }] };
  const capture = (choices: unknown) => ({
    source: "scraper",
    collected_at: "2026-11-07T10:00:00-03:00",
    capture: {
      store: { external_id: STORE_A, url: "https://exemplo.test/a" },
      items: [{ external_item_id: "i", name: "Monte seu prato sintético", price_cents: 0, minimum_price_cents: 1900, choices }],
    },
  });
  const parse = (choices: unknown) => parseExtractResult("capture", STORE_A, capture(choices), NOW);
  const items = (r: ReturnType<typeof parse>) => {
    if (!r.ok) throw new Error(r.errors.join());
    return r.copies[0]!.content.items as Record<string, unknown>[];
  };

  it("M1_choices_are_kept_with_groups_and_options", () => {
    const r = parse([CHOICE]);
    expect(items(r)[0]!.choices).toEqual([CHOICE]);
    expect(r.ok && r.dropped).toEqual([]);
  });

  it("M1_choices_null_counts_as_absent", () => {
    expect(items(parse(null))[0]).not.toHaveProperty("choices");
  });

  it("M1_choices_drop_unknown_fields_inside_groups_and_options", () => {
    const r = parse([{ ...CHOICE, raw: "x", options: [{ ...CHOICE.options[0], foto: "y" }] }]);
    expect(items(r)[0]!.choices).toEqual([{ ...CHOICE, options: [CHOICE.options[0]] }]);
    expect(r.dropped).toEqual(["capture.items[].choices[].options[].foto", "capture.items[].choices[].raw"]);
  });

  it("M1_choices_malformed_are_refused_with_the_path", () => {
    const errors = (c: unknown) => {
      const r = parse(c);
      return r.ok ? [] : r.errors;
    };
    expect(errors("x")).toEqual(["capture.items[0].choices: must be an array"]);
    expect(errors([{ ...CHOICE, min: 2, max: 1 }])).toEqual(["capture.items[0].choices[0]: min is above max"]);
    expect(errors([{ ...CHOICE, options: [] }])).toEqual(["capture.items[0].choices[0].options: must be an array with at least one option"]);
    expect(errors([{ ...CHOICE, options: [{ name: "Sem preço" }] }])).toEqual(["capture.items[0].choices[0].options[0].price_cents: required"]);
    expect(errors([{ name: "Grupo", options: CHOICE.options, max: 1 }])).toEqual(["capture.items[0].choices[0].min: required"]);
    expect(errors([{ ...CHOICE, name: "<html>" }])).toEqual(["capture.items[0].choices[0].name: must not hold raw HTML"]);
  });
});

describe("B01 fail reasons", () => {
  it("B01_fail_accepts_network_besides_the_old_reasons", () => {
    expect([...FAIL_REASONS]).toEqual(["blocked", "not_found", "parse_error", "timeout", "network", "other"]);
    expect(isFailReason("network")).toBe(true);
    expect(isFailReason("stuck")).toBe(false);
  });
});
