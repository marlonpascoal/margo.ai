// Production wiring of the notifier. Server code only.
import { adminClient } from "@/lib/supabase/admin";
import { alertConfigFromEnv, type AlertConfig } from "./alerts";
import type { NotifyDeps } from "./outbox";
import { ChannelNotifier, DevInbox, DevInboxProvider, MailpitProvider, ManualWhatsAppProvider, devInboxFile, type AttachmentLoader, type Notifier } from "./providers";
import { SupabaseNotifyStore } from "./supabase-store";

export function notifyDeps(): NotifyDeps {
  return { store: new SupabaseNotifyStore(adminClient()), now: () => new Date() };
}

export function alertDeps(): NotifyDeps & { config: AlertConfig } {
  return { ...notifyDeps(), config: alertConfigFromEnv() };
}

/** E01: the P06 PDF from Storage ("closes/G-02/2026-09/fechamento-G-02-2026-09.pdf"). */
export const storageAttachment: AttachmentLoader = async (path) => {
  const [bucket, ...rest] = path.split("/");
  const { data, error } = await adminClient().storage.from(bucket).download(rest.join("/"));
  if (error || !data) return null;
  const filename = rest[rest.length - 1];
  return { filename, contentType: data.type || "application/octet-stream", bytes: new Uint8Array(await data.arrayBuffer()) };
};

/**
 * Locally (MARGO_ENV=local) e-mail goes to the local Mailpit (HTML, text and attachment) when the stack
 * gives its URL, and to the dev inbox file either way. Elsewhere the e-mail slot stays empty until D36
 * picks a provider, so e-mail rows fail loudly instead of pretending to be sent.
 */
export function notifierFromEnv(env: Record<string, string | undefined> = process.env): Notifier {
  const inbox = env.MARGO_ENV === "local" ? new DevInbox(devInboxFile()) : null;
  const email = !inbox ? null : env.MAILPIT_URL ? new MailpitProvider(env.MAILPIT_URL, undefined, storageAttachment, inbox) : new DevInboxProvider(inbox);
  return new ChannelNotifier({ email, whatsappManual: new ManualWhatsAppProvider(inbox) });
}
