// Flag checks for server code (04 §6, A05). A flag that is off, or that cannot be evaluated, counts as
// off: OpenFeature returns the default (false) on any provider error.
import { notFound } from "next/navigation";
import type { Client } from "@openfeature/server-sdk";
import type { FlagKey } from "./keys";
import { accountContext } from "./provider";

export interface Flags {
  /** 04 §6 evaluation for this account; null for console screens and system work. */
  isEnabled(key: FlagKey, accountId: string | null): Promise<boolean>;
  /** A05: a screen whose flag is off answers 404. Call at the top of the page or route. */
  requireFlag(key: FlagKey, accountId: string | null): Promise<void>;
}

export function createFlags(client: () => Promise<Client>): Flags {
  const isEnabled = async (key: FlagKey, accountId: string | null) =>
    (await client()).getBooleanValue(key, false, accountContext(accountId));
  return {
    isEnabled,
    async requireFlag(key, accountId) {
      if (!(await isEnabled(key, accountId))) notFound();
    },
  };
}
