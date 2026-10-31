"use client";
// The short code is shown once, here, and never stored in clear (06 §9). Not drawn: copy listed for Marlon.
import { useActionState } from "react";
import { BUTTON_PRIMARY } from "@/components/console";
import { pairingCodeAction, type CodeState } from "./actions";

const hm = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

export default function PairingCodeForm({ account, people }: { account: string; people: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<CodeState, FormData>(pairingCodeAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="conta" value={account} />
      <label htmlFor="pessoa" className="text-sm text-ink-muted">
        Para quem
      </label>
      <select id="pessoa" name="pessoa" className="min-h-10 rounded-sm border border-border-strong bg-surface px-2.5 text-md text-ink">
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending} className={`${BUTTON_PRIMARY} self-start`}>
        Gerar código
      </button>
      {state && "code" in state && (
        <div role="status" className="flex flex-col gap-1 rounded-md bg-ok-bg p-3">
          <span className="font-mono text-2xl tracking-[0.12em]" data-pairing-code>
            {state.code}
          </span>
          <span className="text-sm text-ink-2">
            Código de {state.person}, vale até {hm(state.expiresAt)} e uma vez só. A pessoa digita na extensão, no computador dela.
          </span>
        </div>
      )}
      {state && "error" in state && (
        <p role="alert" className="m-0 text-sm text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
