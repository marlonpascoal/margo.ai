// B01 owner journey, web side: the P21 time range, refusals, the permission mirror, commands and loaders over fakes.
// The SQL side is in supabase/tests/m1/m1_monitor.test.sql and m1_positions.test.sql; the run flow in
// workers/collector/tests/test_b01_monitor_db.py.
import { describe, expect, it } from "vitest";
import type { ReadDb } from "@/lib/supabase/reader";
import { answerDoubt, confirmSuggestions, createMonitor, undoAnswer, type MonitorDeps } from "./commands";
import { loadDoubts, loadResult, paceInput, type Progress } from "./load";
import { canAnswerDoubts, canManageMonitors, doubtReason, etaRange, etaText, isSlow, monitorRefusal, periodOptions, refusalText, roundUpMinutes, type PaceInput } from "./rules";

const NOW = new Date("2026-11-07T14:00:00-03:00");
const base: PaceInput = {
  step: "capture",
  remaining: 10,
  running: 2,
  finishedSinceStart: 0,
  finishedInWindow: 0,
  windowMinutes: 15,
  typicalSeconds: 50,
  maxRunning: 20,
  latestRetryAt: null,
  lastFinishedAt: null,
  startedAt: new Date(NOW.getTime() - 2 * 60_000),
  slowMinutes: 5,
  now: NOW,
};

describe("B01 P21 time range", () => {
  it("B01_eta_uses_50_seconds_per_capture_with_fewer_than_3_done", () => {
    // 2 lanes x 60/50 = 2.4 per minute; 10 / 2.4 = 4.17 + 2 = 6.17 -> 10; high 7.5 + 5 = 12.5 -> 15.
    expect(etaRange(base)).toEqual({ kind: "range", lowMinutes: 10, highMinutes: 15 });
  });

  it("B01_eta_uses_the_runs_own_pace_over_the_last_15_minutes", () => {
    const e = etaRange({ ...base, finishedSinceStart: 6, finishedInWindow: 3, remaining: 20 });
    // 3 / 15 = 0.2 per minute; 20 / 0.2 = 100 + 2 = 102 -> 105; high 180 + 5 = 185 -> 195.
    expect(e).toEqual({ kind: "range", lowMinutes: 105, highMinutes: 195 });
    expect(etaText(e)).toBe("cerca de 2 a 3 horas");
  });

  it("B01_eta_waits_for_a_later_retry", () => {
    const e = etaRange({ ...base, latestRetryAt: new Date(NOW.getTime() + 40 * 60_000) });
    expect(e).toEqual({ kind: "range", lowMinutes: 10, highMinutes: 45 });
  });

  it("B01_eta_unknown_while_discovering_and_short_after_captures", () => {
    expect(etaText(etaRange({ ...base, step: "discover" }))).toBe("Costuma levar de 30 minutos a 2 horas.");
    expect(etaRange({ ...base, step: "calc" })).toEqual({ kind: "range", lowMinutes: 5, highMinutes: 5 });
    expect(etaRange({ ...base, step: "ready" })).toEqual({ kind: "done" });
  });

  it("B01_rounds_to_5_minutes_under_an_hour_and_15_above", () => {
    expect([roundUpMinutes(1), roundUpMinutes(41), roundUpMinutes(61)]).toEqual([5, 45, 75]);
  });

  it("B01_slow_when_nothing_finished_for_5_minutes", () => {
    expect(isSlow(base)).toBe(false);
    expect(isSlow({ ...base, startedAt: new Date(NOW.getTime() - 6 * 60_000) })).toBe(true);
    expect(isSlow({ ...base, startedAt: new Date(NOW.getTime() - 60 * 60_000), lastFinishedAt: new Date(NOW.getTime() - 60_000) })).toBe(false);
    expect(isSlow({ ...base, remaining: 0, startedAt: new Date(0) })).toBe(false);
  });

  it("B01_pace_input_from_the_progress_answer", () => {
    const p = {
      step: "capture",
      created_at: "2026-11-07T16:50:00Z",
      now: "2026-11-07T17:00:00Z",
      quorum: { finished: 20, total: 31, required: 28 },
      counts: { running: 3 },
      pace: { finished_since_start: 20, finished_in_window: 6, last_finished_at: null, latest_retry_at: null, window_minutes: 15, typical_seconds: 50, slow_minutes: 5, max_running: 20 },
    } as unknown as Progress;
    expect(paceInput(p)).toMatchObject({ remaining: 8, running: 3, finishedInWindow: 6, step: "capture" });
  });
});

describe("B01 refusals and permissions (draft §2.1, provisional)", () => {
  it("B01_maps_every_refusal_of_the_sql_functions", () => {
    expect(monitorRefusal("monitor_competitor_limit:3")).toEqual({ code: "competitor_limit", limit: 3 });
    expect(monitorRefusal("monitor_competitor_month_limit:3")).toEqual({ code: "competitor_month_limit", limit: 3 });
    expect(monitorRefusal("monitor_own_limit:1")).toEqual({ code: "own_limit", limit: 1 });
    expect(monitorRefusal("monitor_min_every_days:90")).toEqual({ code: "min_every_days", days: 90 });
    expect(monitorRefusal("monitor_exists:3fa85f64-5717-4562-b3fc-2c963f66afa6")).toEqual({ code: "exists", monitorId: "3fa85f64-5717-4562-b3fc-2c963f66afa6" });
    expect(monitorRefusal("competitor_xray_not_in_plan")).toEqual({ code: "competitor_not_in_plan" });
    expect(monitorRefusal("boom")).toBeNull();
    expect(refusalText({ code: "competitor_limit", limit: 3 })).toBe("Seu plano permite 3 concorrentes ao mesmo tempo. Pause ou remova um, ou veja os planos.");
    expect(refusalText({ code: "already_answered" })).toBe("Outra pessoa já respondeu este item.");
  });

  it("A03_gerente_answers_only_for_monitorings_of_own_kitchens", () => {
    const opts = { gerenteAnswers: true, monitorKitchenId: "k1", kitchenIds: ["k1"], allKitchens: false };
    expect(canAnswerDoubts("dono", { ...opts, monitorKitchenId: null })).toBe(true);
    expect(canAnswerDoubts("gerente", opts)).toBe(true);
    expect(canAnswerDoubts("gerente", { ...opts, monitorKitchenId: "k2" })).toBe(false);
    expect(canAnswerDoubts("gerente", { ...opts, gerenteAnswers: false })).toBe(false);
    expect(canAnswerDoubts("financeiro", opts)).toBe(false);
    expect([canManageMonitors("dono"), canManageMonitors("gerente"), canManageMonitors("financeiro")]).toEqual([true, false, false]);
  });

  it("B01_periods_offered_from_the_plan_minimum", () => {
    expect(periodOptions(7).map((p) => p.days)).toEqual([7, 14, 28, 90]);
    expect(periodOptions(90).map((p) => p.days)).toEqual([90]);
  });

  it("B01_doubt_reason_in_owner_words", () => {
    expect(doubtReason("tamanho ilegível", 3)).toBe("Não deu para ler o tamanho no nome");
    expect(doubtReason("poucos pares", 2)).toBe("Só 2 lojas vendem algo parecido");
    expect(doubtReason("categoria não identificada", 0)).toBe("Não sabemos o tipo deste item");
  });
});

function fakeDeps(answers: Record<string, unknown>, fail?: string) {
  const calls: [string, Record<string, unknown>][] = [];
  const woken: [string, string][] = [];
  const deps: MonitorDeps = {
    env: "sandbox",
    async rpc(fn, args) {
      calls.push([fn, args]);
      if (fail) throw new Error(fail);
      return answers[fn];
    },
    async wake(id, type) {
      woken.push([id, type]);
    },
  };
  return { deps, calls, woken };
}

const actor = { personId: "p1", ip: null, userAgent: null };

describe("B01 commands", () => {
  it("B01_create_passes_the_flag_env_and_maps_the_limit", async () => {
    const ok = fakeDeps({ monitor_create: { monitor_id: "m", xray_id: "x", target_kind: "own" } });
    const r = await createMonitor(ok.deps, actor, { accountId: "a", externalId: "e", url: "u", kitchenId: null, everyDays: 7, radiusKm: 3, categories: [], rules: {} });
    expect(r).toEqual({ ok: true, value: { monitorId: "m", xrayId: "x", targetKind: "own" } });
    expect(ok.calls[0][1]).toMatchObject({ p_env: "sandbox", p_actor: "p1", p_every_days: 7 });
    const no = fakeDeps({}, "monitor_competitor_limit:3");
    expect(await createMonitor(no.deps, actor, { accountId: "a", externalId: "e", url: "u", kitchenId: "k", everyDays: 7, radiusKm: 3, categories: [], rules: {} }))
      .toEqual({ ok: false, refusal: { code: "competitor_limit", limit: 3 } });
  });

  it("B01_answer_wakes_the_recalculation_and_undo_the_pairing", async () => {
    const f = fakeDeps({ monitor_answer: "calc-1", monitor_undo: "pair-1" });
    expect(await answerDoubt(f.deps, actor, "i1", ["p1"])).toMatchObject({ ok: true });
    expect(f.calls[0][1]).toMatchObject({ p_item: "i1", p_accepted: ["p1"], p_if_unanswered: true });
    await undoAnswer(f.deps, actor, "i1");
    expect(f.woken).toEqual([["calc-1", "xray_calc"], ["pair-1", "xray_pair"]]);
  });

  it("B01_unknown_errors_are_rethrown", async () => {
    await expect(answerDoubt(fakeDeps({}, "connection lost").deps, actor, "i1", [])).rejects.toThrow("connection lost");
  });
});

/** A ReadDb that answers one row per table (or none: RLS hid it). */
function fakeDb(rows: Record<string, unknown[]>): ReadDb {
  const q = (table: string) => {
    const chain = {
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: async () => ({ data: rows[table] ?? [], error: null }),
      maybeSingle: async () => ({ data: (rows[table] ?? [])[0] ?? null, error: null }),
      then: (r: (v: unknown) => unknown) => r({ data: rows[table] ?? [], error: null }),
    };
    return chain;
  };
  return { from: (t: string) => ({ select: () => q(t) }) } as unknown as ReadDb;
}

const MON = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const RUN = "9b1c22d0-4e8a-4c3b-9f21-7d5e0a6b3c41";
const monitorRow = { id: MON, status: "active", target_kind: "own", kitchen_id: null, every_days: 7, radius_km: 3, next_run_at: null, last_xray_id: RUN };

describe("A02 loaders read the monitoring with RLS first", () => {
  it("A02_a_monitoring_rls_hides_never_reaches_the_service_role", async () => {
    const calls: string[] = [];
    const deps = { db: fakeDb({}), env: "sandbox" as const, rpc: async (fn: string) => (calls.push(fn), {}) };
    expect(await loadDoubts(deps, MON)).toBeNull();
    expect(await loadResult(deps, MON)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("B01_doubts_of_the_newest_run_after_the_rls_read", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const deps = { db: fakeDb({ xray_monitor: [monitorRow], xray: [{ id: RUN }] }), env: "sandbox" as const, rpc: async (fn: string, a: Record<string, unknown>) => (calls.push([fn, a]), { open: 1 }) };
    expect(await loadDoubts(deps, MON)).toEqual({ open: 1 });
    expect(calls).toEqual([["monitor_doubts", { p_xray: RUN }]]);
  });

  it("B01_result_is_null_until_the_run_is_calculated", async () => {
    const deps = { db: fakeDb({ xray_monitor: [monitorRow], xray: [{ id: RUN }] }), env: "sandbox" as const, rpc: async () => ({ status: "collecting" }) };
    expect(await loadResult(deps, MON)).toBeNull();
  });
});

describe("B01 P22 reasons after pairing Stage 2", () => {
  it("B01_P22_stage2_reasons_in_owner_words", () => {
    expect(doubtReason("proteína ilegível", 2)).toBe("Não deu para ler a proteína no nome");
    expect(doubtReason("tamanho presumido 500 ml", 2)).toBe("Não deu para ler o tamanho no nome; supomos 500 ml");
  });
});

describe("B01 commands send every SQL parameter that has no default", () => {
  it("B01_P20_P22_null_kitchen_and_null_items_are_sent_not_omitted", async () => {
    const calls: Record<string, unknown>[] = [];
    const deps: MonitorDeps = {
      env: "sandbox",
      rpc: async (fn, args) => {
        calls.push({ fn, ...args });
        return fn === "monitor_create" ? { monitor_id: "m", xray_id: "x", target_kind: "own" } : null;
      },
      wake: async () => {},
    };
    const actor = { personId: "p", ip: null, userAgent: null };
    await createMonitor(deps, actor, { accountId: "a", externalId: "e", url: "u", kitchenId: null, everyDays: 7, radiusKm: 3, categories: [], rules: {} });
    await confirmSuggestions(deps, actor, "x", null);
    expect("p_kitchen" in calls[0] && calls[0].p_kitchen === null).toBe(true);
    expect("p_items" in calls[1] && calls[1].p_items === null).toBe(true);
  });
});
