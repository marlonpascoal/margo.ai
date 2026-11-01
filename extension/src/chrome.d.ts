// The few Chrome extension APIs the popup, the content script and the background use (no @types/chrome: the
// build works offline from the lockfile).
declare namespace chrome {
  namespace storage {
    const local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string[]): Promise<void>;
    };
  }
  namespace runtime {
    const id: string;
    interface MessageSender {
      id?: string;
      /** Present when the message comes from a content script; `url` is the page it runs in. */
      tab?: { id?: number; url?: string };
      url?: string;
    }
    function sendMessage<T = unknown>(message: unknown): Promise<T>;
    const onMessage: {
      addListener(cb: (message: unknown, sender: MessageSender, sendResponse: (response?: unknown) => void) => boolean | void): void;
    };
  }
  namespace tabs {
    /** `url` is present only for tabs on a host the extension has permission for (the Partner Portal). */
    function query(q: { active: boolean; currentWindow: boolean }): Promise<{ id?: number; url?: string }[]>;
    /** To the content script of that tab; rejects when none is listening (not the Partner Portal). */
    function sendMessage<T = unknown>(tabId: number, message: unknown): Promise<T>;
  }
}

/** Our API origin, set at build time (build.mjs, MARGO_API_URL). */
declare const __MARGO_API__: string;
