"use client";
// W04 "Convidar pessoa" / P14 "Convidar pelo WhatsApp" (05 P14/W04: WhatsApp or e-mail, profile, kitchens)
// and "Reenviar convite". No drawing of the form itself: its copy is listed in the wave 2 report.
import { useActionState, useId, useState, type FormEvent } from "react";
import { INVITE_MESSAGES } from "@/lib/portal/scope";
import { invitePersonAction, resendInviteAction, type InviteState } from "./actions";

const FIELD = "min-h-10 rounded-md border border-border-strong bg-surface px-2.5 text-md";

function Result({ state }: { state: InviteState }) {
  if (!state) return null;
  if (state.error)
    return (
      <p role="alert" className="m-0 text-sm text-danger">
        {state.error}
      </p>
    );
  return (
    <div role="status" className="flex flex-col gap-2 rounded-md bg-ok-bg p-3 text-sm">
      <span>Convite criado. Ele vale por 7 dias e só pode ser usado uma vez.</span>
      <input readOnly value={state.link} aria-label="Link do convite" className={`${FIELD} font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
      {state.share && (
        <a href={state.share} target="_blank" rel="noreferrer" className="font-semibold">
          {state.shareLabel}
        </a>
      )}
    </div>
  );
}

export function InviteForm({ label, kitchens, summaryClass }: { label: string; kitchens: { id: string; name: string }[]; summaryClass: string }) {
  const [state, action, pending] = useActionState(invitePersonAction, null);
  const id = useId();
  const [role, setRole] = useState("financeiro");
  const [localError, setLocalError] = useState<string | null>(null);
  // A Gerente needs at least one kitchen (Marlon, 31/out); the server action checks it again.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    const none = new FormData(e.currentTarget).getAll("cozinha").length === 0;
    if (role === "gerente" && none) {
      e.preventDefault();
      setLocalError(INVITE_MESSAGES.gerenteNeedsKitchen);
    } else setLocalError(null);
  };
  return (
    <details className="group">
      <summary className={`${summaryClass} list-none [&::-webkit-details-marker]:hidden`}>{label}</summary>
      <form action={action} onSubmit={onSubmit} className="mt-3 flex max-w-[440px] flex-col gap-2.5 rounded-xl border border-border bg-surface p-4 text-md" data-invite-form>
        <label htmlFor={`${id}-nome`}>Nome (opcional)</label>
        <input id={`${id}-nome`} name="nome" maxLength={80} className={FIELD} />
        <fieldset className="m-0 flex gap-4 border-0 p-0">
          <legend className="mb-1.5">Mandar por</legend>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="canal" value="whatsapp" defaultChecked /> WhatsApp
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="canal" value="email" /> E-mail
          </label>
        </fieldset>
        <label htmlFor={`${id}-contato`}>WhatsApp com DDD ou e-mail</label>
        <input id={`${id}-contato`} name="contato" required className={FIELD} />
        <label htmlFor={`${id}-perfil`}>Perfil</label>
        <select id={`${id}-perfil`} name="perfil" value={role} onChange={(e) => { setRole(e.target.value); setLocalError(null); }} className={FIELD}>
          <option value="dono">Dono</option>
          <option value="financeiro">Financeiro</option>
          <option value="gerente">Gerente de cozinha</option>
        </select>
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="mb-1.5">{role === "gerente" ? "Cozinhas (marque pelo menos uma)" : "Cozinhas (nenhuma marcada: todas)"}</legend>
          {kitchens.map((k) => (
            <label key={k.id} className="flex items-center gap-1.5">
              <input type="checkbox" name="cozinha" value={k.id} /> {k.name}
            </label>
          ))}
        </fieldset>
        <button type="submit" disabled={pending} className="min-h-11 cursor-pointer rounded-md border-0 bg-ink px-4.5 font-semibold text-ink-inverse">
          Criar convite
        </button>
        {localError ? (
          <p role="alert" className="m-0 text-sm text-danger">
            {localError}
          </p>
        ) : (
          <Result state={state} />
        )}
      </form>
    </details>
  );
}

export function ResendInvite({ inviteId, className }: { inviteId: string; className: string }) {
  const [state, action, pending] = useActionState(resendInviteAction, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="convite" value={inviteId} />
      <button type="submit" disabled={pending} className={className}>
        Reenviar convite
      </button>
      <Result state={state} />
    </form>
  );
}
