// Shared classes of the owner portal entry screens (P07, P15, P17, P18, W06), design tokens only.
export const inputClass = "box-border min-h-12 w-full rounded-md border border-border-strong bg-surface px-3 text-base text-ink";
export const labelClass = "text-sm font-semibold";
export const primaryClass =
  "flex min-h-12 w-full cursor-pointer items-center justify-center rounded-lg border-0 bg-ink text-base font-bold text-ink-inverse no-underline hover:text-ink-inverse disabled:opacity-70";
export const secondaryClass =
  "inline-flex min-h-10 cursor-pointer items-center justify-center rounded-md border border-border-strong bg-surface px-4 text-md text-ink no-underline";

export async function postJson<T = { ok: boolean; message?: string; next?: string }>(path: string, body: object): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json().catch(() => ({ ok: false }))) as T;
}
