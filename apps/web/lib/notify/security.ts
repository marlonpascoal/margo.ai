// security_event (04 §9, P15): a login on a new device notifies every Dono of the person's accounts.
// Goes through notify(), so each Dono's preferences apply (E05); e-mail always goes because the notice
// is locked on.
import { notify, type NotifyDeps } from "./outbox";
import type { NoticeMessage } from "./plan";

export function newDeviceMessage(personName: string, userAgent: string | null): NoticeMessage {
  return {
    subject: "Login em aparelho novo",
    body: `${personName} entrou na MargoAI por um aparelho novo${userAgent ? ` (${userAgent})` : ""}.`,
  };
}

export interface NewDeviceNotice {
  personName: string;
  accountIds: string[];
  userAgent: string | null;
}

/** P15, E05: one security_event per account, planned for that account's Donos. */
export async function notifyNewDevice(deps: NotifyDeps, n: NewDeviceNotice): Promise<{ queued: number; held: number }> {
  const total = { queued: 0, held: 0 };
  const message = newDeviceMessage(n.personName, n.userAgent);
  for (const accountId of n.accountIds) {
    const r = await notify(deps, { code: "security_event", accountId, message });
    total.queued += r.queued;
    total.held += r.held;
  }
  return total;
}
