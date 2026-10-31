"use client";
// W07 step 2 (06 §9): after installing, the owner asks here for the short code to type in the extension
// (P04). It comes from POST /api/extension/code for the signed-in person in the open account; shown once,
// never stored in clear. Not drawn: copy listed for Marlon.
import { useState } from "react";

const hm = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

type State = { code: string; expiresAt: string } | { error: string } | null;

export default function PairingCode({ account }: { account: string }) {
  const [state, setState] = useState<State>(null);
  const [busy, setBusy] = useState(false);
  async function ask() {
    setBusy(true);
    try {
      const res = await fetch("/api/extension/code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account }) });
      const body = (await res.json().catch(() => null)) as { code?: string; expiresAt?: string; error?: string } | null;
      setState(res.ok && body?.code && body.expiresAt ? { code: body.code, expiresAt: body.expiresAt } : { error: body?.error ?? "Não deu certo. Tente de novo." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={ask} disabled={busy} className="min-h-10 cursor-pointer rounded-md border border-ink bg-surface text-md font-semibold text-ink disabled:opacity-60">
        Mostrar o código da extensão
      </button>
      {state && "code" in state && (
        <div role="status" className="flex flex-col gap-1 rounded-md bg-ok-bg p-3">
          <span className="font-mono text-2xl tracking-[0.12em]" data-pairing-code>
            {state.code}
          </span>
          <span className="text-sm text-ink-2">Digite este código na extensão. Vale até {hm(state.expiresAt)} e uma vez só.</span>
        </div>
      )}
      {state && "error" in state && (
        <p role="alert" className="m-0 text-sm text-danger">
          {state.error}
        </p>
      )}
    </div>
  );
}
