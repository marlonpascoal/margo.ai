// security_event (04 §9, P15): a login on a new device notifies every Dono of the person's accounts, with
// the security_event e-mail template of apps/web/emails. Goes through notify(), so each Dono's preferences
// apply (E05); e-mail always goes because the notice is locked on.
import { emailSource, securityEventEmail } from "@/emails";
import { notify, type NotifyDeps } from "./outbox";

export interface NewDeviceNotice {
  personName: string;
  accountIds: string[];
  userAgent: string | null;
  /** Accounts with is_synthetic: their e-mails carry the SINTÉTICO label (D46). */
  syntheticAccountIds?: string[];
}

/** P15, E05: one security_event per account, planned for that account's Donos. */
export async function notifyNewDevice(deps: NotifyDeps, n: NewDeviceNotice): Promise<{ queued: number; held: number }> {
  const total = { queued: 0, held: 0 };
  const content = securityEventEmail({ kind: "new_device", personName: n.personName, userAgent: n.userAgent });
  for (const accountId of n.accountIds) {
    const message = emailSource(content, { synthetic: n.syntheticAccountIds?.includes(accountId) ?? false });
    const r = await notify(deps, { code: "security_event", accountId, message });
    total.queued += r.queued;
    total.held += r.held;
  }
  return total;
}
