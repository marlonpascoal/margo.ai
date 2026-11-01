// P04 background (service worker): the daily send's side that talks to our API (06 §9). Answers only our own
// content script on a Partner Portal page. Holds no page content; the token stays in chrome.storage.local.
import { chromeTokens, createClient } from "./api";
import { API_BASE } from "./config";
import { dailyMessage, type DailyStore } from "./daily";
import { onPartnerPortal } from "./view";

const store: DailyStore = {
  async get() {
    const v = (await chrome.storage.local.get(["dailyAttempt"])).dailyAttempt;
    return typeof v === "string" ? v : null;
  },
  set: (day) => chrome.storage.local.set({ dailyAttempt: day }),
};

const client = createClient(API_BASE, (url, init) => fetch(url, init), chromeTokens());

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !onPartnerPortal(sender.tab?.url)) return;
  const answer = dailyMessage(msg, client, store, new Date());
  if (!answer) return;
  void answer.then(reply, () => reply(null));
  return true;
});
