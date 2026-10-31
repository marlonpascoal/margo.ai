import { describe, expect, it } from "vitest";
import { accessLine, groupDevices, type SessionRow } from "./security";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";
const row = (id: string, key: string | null, ua: string, city: string, at: string): SessionRow => ({ id, device_key_hash: key, user_agent: ua, ip_city: city, last_seen_at: at });

describe("W09 devices and access log", () => {
  const now = new Date("2026-10-30T12:00:00-03:00");

  it("W09_one_entry_per_device_current_first_as_drawn", () => {
    const devices = groupDevices(
      [
        row("a1", "mac", MAC, "Londrina", "2026-10-30T08:00:00-03:00"),
        row("a2", "mac", MAC, "Londrina", "2026-10-30T08:12:00-03:00"),
        row("b", "android", ANDROID, "Londrina", "2026-10-29T21:10:00-03:00"),
      ],
      "a2",
      now,
    );
    expect(devices).toEqual([
      { ids: ["a1", "a2"], name: "Chrome no Mac", where: "este aparelho · Londrina", current: true },
      { ids: ["b"], name: "Celular Android", where: "ontem 21:10 · Londrina", current: false },
    ]);
  });

  it("W09_access_log_lines_as_drawn", () => {
    const base = { actorName: "Pessoa do financeiro", at: "" };
    expect(accessLine({ ...base, action: "login", actor_person_id: "me", after: null }, "me")).toBe("Você entrou com código por e-mail");
    expect(accessLine({ ...base, action: "login", actor_person_id: "fin", after: null }, "me")).toBe("Pessoa do financeiro entrou");
    expect(accessLine({ ...base, action: "login.new_device", actor_person_id: "me", after: { device: "Chrome no Windows" } }, "me")).toBe(
      "Login em aparelho novo: Chrome no Windows",
    );
    expect(accessLine({ ...base, action: "invite.create", actor_person_id: "me", after: { name: "Contador", role: "financeiro" } }, "me")).toBe(
      "Você convidou Contador (Financeiro)",
    );
  });
});
