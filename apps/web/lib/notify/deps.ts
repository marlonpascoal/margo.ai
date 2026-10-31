// Production wiring of the notifier. Server code only.
import { adminClient } from "@/lib/supabase/admin";
import { alertConfigFromEnv, type AlertConfig } from "./alerts";
import type { NotifyDeps } from "./outbox";
import { ChannelNotifier, DevInbox, DevInboxProvider, ManualWhatsAppProvider, devInboxFile, type Notifier } from "./providers";
import { SupabaseNotifyStore } from "./supabase-store";

export function notifyDeps(): NotifyDeps {
  return { store: new SupabaseNotifyStore(adminClient()), now: () => new Date() };
}

export function alertDeps(): NotifyDeps & { config: AlertConfig } {
  return { ...notifyDeps(), config: alertConfigFromEnv() };
}

/**
 * Locally (MARGO_ENV=local) e-mail goes to the dev inbox. Elsewhere the e-mail slot stays empty until
 * D36 picks a provider, so e-mail rows fail loudly instead of pretending to be sent.
 */
export function notifierFromEnv(): Notifier {
  const inbox = process.env.MARGO_ENV === "local" ? new DevInbox(devInboxFile()) : null;
  return new ChannelNotifier({ email: inbox ? new DevInboxProvider(inbox) : null, whatsappManual: new ManualWhatsAppProvider(inbox) });
}
