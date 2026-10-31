// D29: an iFood store is known by the uuid at the end of its public URL (C02). Same rule as
// workers/collector/src/margo_collector/ifood_public.py.
const STORE_URL =
  /^(?:https?:\/\/)?(?:www\.)?ifood\.com\.br\/delivery\/[^/?#\s]+\/[^/?#\s]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?(?:[?#].*)?$/i;

/** The store uuid, lower case, or null when the text is not an iFood store link. */
export function storeIdFromUrl(url: string): string | null {
  const m = STORE_URL.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

/** https, www host, no query: the form kept in public_store.url. */
export function canonicalStoreUrl(url: string): string {
  const bare = url.trim().split(/[?#]/, 1)[0].replace(/\/+$/, "");
  return bare.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "https://www.");
}
