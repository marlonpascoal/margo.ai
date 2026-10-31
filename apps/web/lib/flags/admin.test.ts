// C20 (04 §5, §6): permission check and validation of the flag changes, against a fake store.
// The writes and their feature_flag_log and audit_log rows are tested in pgTAP and flags.int.test.ts.
import { beforeEach, describe, expect, it } from "vitest";
import { addException, MESSAGES, removeException, setPlanDefault, type Actor, type FlagAdminStore, type StaffRole } from "./admin";
import type { FlagKey } from "./keys";

class FakeStore implements FlagAdminStore {
  roles = new Map<string, StaffRole>();
  writes: { op: string; payload: unknown; actor: Actor }[] = [];
  async staffRole(personId: string) { return this.roles.get(personId) ?? null; }
  async setDefault(payload: unknown, actor: Actor) { this.writes.push({ op: "default", payload, actor }); }
  async setException(payload: unknown, actor: Actor) { this.writes.push({ op: "exception", payload, actor }); }
  async removeException(payload: unknown, actor: Actor) { this.writes.push({ op: "remove", payload, actor }); }
}

const fundador: Actor = { personId: "p-fundador", ip: "10.0.0.1", userAgent: "vitest" };
const operacao: Actor = { personId: "p-operacao", ip: null, userAgent: null };
const stranger: Actor = { personId: "p-dono", ip: null, userAgent: null };
let store: FakeStore;

beforeEach(() => {
  store = new FakeStore();
  store.roles.set(fundador.personId, "fundador");
  store.roles.set(operacao.personId, "operacao");
});

describe("C20 changes", () => {
  it("C20_fundador_sets_a_plan_default", async () => {
    const change = { key: "m2.contestacao", env: "sandbox", plan: "lucro", value: false } as const;
    expect(await setPlanDefault(store, fundador, change)).toEqual({ ok: true });
    expect(store.writes).toEqual([{ op: "default", payload: change, actor: fundador }]);
  });

  it("C20_operacao_and_non_staff_are_refused_and_nothing_is_written", async () => {
    const forbidden = { ok: false, error: "forbidden", message: MESSAGES.forbidden };
    const change = { key: "m2.contestacao", env: "sandbox", accountId: "acc-1", value: true, reason: "piloto" } as const;
    for (const actor of [operacao, stranger]) {
      expect(await setPlanDefault(store, actor, { key: "m2.contestacao", env: "sandbox", plan: "lucro", value: false })).toEqual(forbidden);
      expect(await addException(store, actor, change)).toEqual(forbidden);
      expect(await removeException(store, actor, { key: "m2.contestacao", env: "sandbox", accountId: "acc-1" })).toEqual(forbidden);
    }
    expect(store.writes).toEqual([]);
  });

  it("C20_exception_needs_a_reason", async () => {
    for (const reason of ["", "   "]) {
      const r = await addException(store, fundador, { key: "m2.ifood_api", env: "production", accountId: "acc-1", value: true, reason });
      expect(r).toEqual({ ok: false, error: "invalid", message: MESSAGES.reason });
    }
    expect(store.writes).toEqual([]);
  });

  it("C20_fundador_adds_and_removes_an_exception_with_trimmed_reason", async () => {
    expect(
      await addException(store, fundador, { key: "m2.ifood_api", env: "production", accountId: "acc-1", value: true, reason: "  piloto " }),
    ).toEqual({ ok: true });
    expect(await removeException(store, fundador, { key: "m2.ifood_api", env: "production", accountId: "acc-1" })).toEqual({ ok: true });
    expect(store.writes.map((w) => [w.op, w.payload])).toEqual([
      ["exception", { key: "m2.ifood_api", env: "production", accountId: "acc-1", value: true, reason: "piloto" }],
      ["remove", { key: "m2.ifood_api", env: "production", accountId: "acc-1" }],
    ]);
  });

  it("C20_unknown_key_plan_or_env_is_refused", async () => {
    const bad = [
      setPlanDefault(store, fundador, { key: "m9.nao_existe" as FlagKey, env: "sandbox", plan: "lucro", value: true }),
      setPlanDefault(store, fundador, { key: "m1.raio_x", env: "sandbox", plan: "gratis" as "lucro", value: true }),
      setPlanDefault(store, fundador, { key: "m1.raio_x", env: "prod" as "sandbox", plan: "lucro", value: true }),
      removeException(store, fundador, { key: "m1.raio_x", env: "sandbox", accountId: "" }),
    ];
    for (const r of await Promise.all(bad)) expect(r).toEqual({ ok: false, error: "invalid", message: MESSAGES.invalid });
    expect(store.writes).toEqual([]);
  });
});
