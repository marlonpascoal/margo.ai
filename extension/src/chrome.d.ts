// The few Chrome extension APIs the popup uses (no @types/chrome: the build works offline from the lockfile).
declare namespace chrome {
  namespace storage {
    const local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string[]): Promise<void>;
    };
  }
  namespace tabs {
    /** `url` is present only for tabs on a host the extension has permission for (the Partner Portal). */
    function query(q: { active: boolean; currentWindow: boolean }): Promise<{ id?: number; url?: string }[]>;
  }
}

/** Our API origin, set at build time (build.mjs, MARGO_API_URL). */
declare const __MARGO_API__: string;
