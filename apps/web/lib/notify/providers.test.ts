// D36, D40: dev inbox and manual WhatsApp providers. Nothing leaves the machine.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChannelNotifier, DevInbox, DevInboxProvider, ManualWhatsAppProvider, devInboxFile } from "./providers";

let dir: string;
let inbox: DevInbox;
const at = new Date("2026-11-05T17:00:00Z");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "margo-inbox-"));
  inbox = new DevInbox(join(dir, "inbox", "inbox.jsonl"), () => at);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const lines = () => readFileSync(inbox.file, "utf8").trim().split("\n").map((l) => JSON.parse(l));

describe("providers", () => {
  it("DevInboxProvider appends one JSON line per e-mail", async () => {
    const p = new DevInboxProvider(inbox);
    const r = await p.send({ notificationId: "n1", channel: "email", to: "dono@exemplo.com.br", subject: "Assunto", body: "Corpo" });
    await p.send({ notificationId: "n2", channel: "email", to: "fin@exemplo.com.br", subject: "Outro", body: "Corpo 2" });
    expect(r).toEqual({ providerId: "dev-inbox:n1" });
    expect(lines()).toEqual([
      { at: at.toISOString(), provider: "dev-inbox", providerId: "dev-inbox:n1", notificationId: "n1", channel: "email", to: "dono@exemplo.com.br", subject: "Assunto", body: "Corpo" },
      expect.objectContaining({ notificationId: "n2", to: "fin@exemplo.com.br" }),
    ]);
  });

  it("ManualWhatsAppProvider returns the click-to-chat link as provider id", async () => {
    const p = new ManualWhatsAppProvider(inbox);
    const r = await p.send({ notificationId: "n3", channel: "whatsapp_manual", to: "+5543912341234", subject: null, body: "Oi" });
    expect(r).toEqual({ providerId: "https://wa.me/5543912341234?text=Oi" });
    expect(lines()[0]).toMatchObject({ provider: "whatsapp-manual", providerId: r.providerId });
  });

  it("ChannelNotifier routes by channel and refuses a channel without a provider", async () => {
    const n = new ChannelNotifier({ email: null, whatsappManual: new ManualWhatsAppProvider() });
    await expect(n.deliver({ notificationId: "a", channel: "email", to: "x@y.com", subject: "s", body: "b" })).rejects.toThrow(/D36/);
    await expect(n.deliver({ notificationId: "b", channel: "whatsapp", to: "+5511999990000", subject: null, body: "b" })).rejects.toThrow(/D24/);
    expect(await n.deliver({ notificationId: "c", channel: "whatsapp_manual", to: "+5511999990000", subject: null, body: "b" }))
      .toEqual({ providerId: "https://wa.me/5511999990000?text=b" });
  });

  it("the dev inbox lives under artifacts/inbox at the repository root", () => {
    const saved = process.env.MARGO_INBOX_DIR;
    delete process.env.MARGO_INBOX_DIR;
    try {
      expect(devInboxFile()).toMatch(/\/artifacts\/inbox\/inbox\.jsonl$/);
    } finally {
      if (saved !== undefined) process.env.MARGO_INBOX_DIR = saved;
    }
  });
});
