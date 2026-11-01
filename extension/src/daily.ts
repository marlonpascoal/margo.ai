// P04 daily send, background side (C07 "Envia sozinha uma vez por dia"): is a send due, claim today's one
// attempt, upload the file the content script captured. Pure of Chrome so the tests drive it with fakes.
import type { Client, Result } from "./api";
import { DAILY_CLAIM, DAILY_DUE, DAILY_UPLOAD, dailyPlan, decodeFile, spDay, type DailyPlan, type EncodedFile } from "./portal";

/** The São Paulo day of the last daily attempt (chrome.storage.local "dailyAttempt"). */
export interface DailyStore {
  get(): Promise<string | null>;
  set(day: string): Promise<void>;
}

type Msg = { type?: string; file?: EncodedFile; storeId?: string | null; reports?: unknown };

let chain: Promise<unknown> = Promise.resolve();
/** One claim at a time, so two portal tabs opening together send once. */
const serial = <T>(work: () => Promise<T>): Promise<T> => {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
};

/** Answer to one message from the content script, or null when it is not one of ours. */
export function dailyMessage(raw: unknown, client: Pick<Client, "status" | "upload">, store: DailyStore, now: Date): Promise<unknown> | null {
  const msg = (raw ?? {}) as Msg;
  switch (msg.type) {
    case DAILY_DUE:
      return (async (): Promise<DailyPlan | null> => {
        const st = await client.status();
        return st.ok ? dailyPlan(st.value, await store.get(), now) : null;
      })();
    case DAILY_CLAIM:
      return serial(async () => {
        const today = spDay(now);
        if ((await store.get()) === today) return false;
        await store.set(today);
        return true;
      });
    case DAILY_UPLOAD: {
      if (!msg.file || typeof msg.file.base64 !== "string") return Promise.resolve(null);
      const reports = Array.isArray(msg.reports) ? msg.reports.filter((r): r is string => typeof r === "string") : [];
      return client.upload(decodeFile(msg.file), typeof msg.storeId === "string" ? msg.storeId : null, reports) as Promise<Result<{ importRunId: string }>>;
    }
    default:
      return null;
  }
}
