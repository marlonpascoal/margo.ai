// Notifier and its providers (D36, D40 item 6). No real e-mail provider yet: D36 leaves the choice open
// (SES, Resend, Postmark), so production has an empty slot. Development writes to a local inbox.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { whatsappLink, type NotificationChannel } from "./plan";

/** One message ready to leave, built from a notification row. */
export interface OutgoingMessage {
  notificationId: string;
  channel: NotificationChannel;
  to: string;
  subject: string | null;
  body: string;
  html?: string | null;
  attachmentPath?: string | null;
}

export interface EmailProvider {
  send(msg: OutgoingMessage): Promise<{ providerId: string }>;
}

export interface WhatsAppProvider {
  send(msg: OutgoingMessage): Promise<{ providerId: string }>;
}

/** Delivers one outbox row on its channel. */
export interface Notifier {
  deliver(msg: OutgoingMessage): Promise<{ providerId: string }>;
}

export class ChannelNotifier implements Notifier {
  constructor(
    private providers: { email: EmailProvider | null; whatsappManual: WhatsAppProvider; whatsapp?: WhatsAppProvider },
  ) {}

  async deliver(msg: OutgoingMessage) {
    switch (msg.channel) {
      case "email":
        if (!this.providers.email) throw new Error("no e-mail provider configured (D36 open)");
        return this.providers.email.send(msg);
      case "whatsapp_manual":
        return this.providers.whatsappManual.send(msg);
      case "whatsapp":
        if (!this.providers.whatsapp) throw new Error("no WhatsApp Business Platform provider (D24)");
        return this.providers.whatsapp.send(msg);
    }
  }
}

/** A JSONL file of every message the dev providers handled. artifacts/ is gitignored. */
export class DevInbox {
  constructor(
    readonly file: string,
    private now: () => Date = () => new Date(),
  ) {}

  append(entry: Record<string, unknown>): void {
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, `${JSON.stringify({ at: this.now().toISOString(), ...entry })}\n`, "utf8");
  }
}

/** Writes each e-mail to the dev inbox instead of sending it (D40). */
export class DevInboxProvider implements EmailProvider {
  constructor(private inbox: DevInbox) {}

  async send(msg: OutgoingMessage) {
    const providerId = `dev-inbox:${msg.notificationId}`;
    this.inbox.append({ provider: "dev-inbox", providerId, ...msg });
    return { providerId };
  }
}

/**
 * D36: a WhatsApp message becomes a click-to-chat link for a founder to send by hand. The link is the
 * provider id, so the console can show it from the notification row. Nothing leaves the server.
 */
export class ManualWhatsAppProvider implements WhatsAppProvider {
  constructor(private inbox: DevInbox | null = null) {}

  async send(msg: OutgoingMessage) {
    const providerId = whatsappLink(msg.to, msg.body);
    this.inbox?.append({ provider: "whatsapp-manual", providerId, ...msg });
    return { providerId };
  }
}

/** A file to attach, read from Storage by "<bucket>/<path>". */
export interface Attachment {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}
export type AttachmentLoader = (path: string) => Promise<Attachment | null>;

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** E01, E02 sender (D36). */
export const SENDER = { Name: "MargoAI", Email: "avisos@margoai.com" } as const;

/**
 * Local only: hands each e-mail (HTML, text, attachment) to the local stack's Mailpit through its send API,
 * so the dev inbox shows it as the owner would see it. Nothing leaves the machine.
 */
export class MailpitProvider implements EmailProvider {
  constructor(
    private baseUrl: string,
    private fetchImpl: Fetch = fetch as unknown as Fetch,
    private attachments: AttachmentLoader | null = null,
    private inbox: DevInbox | null = null,
  ) {}

  async send(msg: OutgoingMessage) {
    const files = msg.attachmentPath && this.attachments ? await this.attachments(msg.attachmentPath) : null;
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/api/v1/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        From: SENDER,
        To: [{ Email: msg.to }],
        Subject: msg.subject ?? "",
        Text: msg.body,
        ...(msg.html ? { HTML: msg.html } : {}),
        ...(files ? { Attachments: [{ Filename: files.filename, ContentType: files.contentType, Content: Buffer.from(files.bytes).toString("base64") }] } : {}),
        Headers: { "X-MargoAI-Notification": msg.notificationId },
      }),
    });
    if (!res.ok) throw new Error(`mailpit send returned ${res.status}`);
    const { ID } = (await res.json()) as { ID?: string };
    const providerId = `mailpit:${ID ?? msg.notificationId}`;
    this.inbox?.append({ provider: "mailpit", providerId, ...msg, html: undefined });
    return { providerId };
  }
}

/** artifacts/inbox/inbox.jsonl at the repository root, or MARGO_INBOX_DIR. */
export function devInboxFile(start = process.cwd()): string {
  if (process.env.MARGO_INBOX_DIR) return join(process.env.MARGO_INBOX_DIR, "inbox.jsonl");
  let dir = resolve(start);
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error("repository root not found for the dev inbox");
    dir = up;
  }
  return join(dir, "artifacts", "inbox", "inbox.jsonl");
}
