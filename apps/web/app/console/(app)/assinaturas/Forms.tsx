"use client";
// C15 forms. The pilot row is drawn (design/C15-Assinaturas.dc.html); "Início do piloto", "Salvar" and the
// plan editor (05 C15 "plan editor", D40) are not drawn and follow the console form style.
import { useActionState, useState } from "react";
import type { PilotLine } from "@/lib/billing/view";
import { savePilotAction, savePlanAction, type FormState } from "./actions";

const field = "box-border min-h-10 w-full rounded-sm border border-border-strong bg-surface px-2 font-mono text-sm text-ink";
const label = "text-ink-muted";
const button = "min-h-10 cursor-pointer rounded-md border border-border-strong bg-surface px-3.5 text-md text-ink disabled:opacity-60";
const initial: FormState = { message: null, saved: false };

function Status({ state }: { state: FormState }) {
  if (state.message) return <span role="alert" className="text-xs text-danger">{state.message}</span>;
  return state.saved ? <span role="status" className="text-xs text-ok">Salvo.</span> : null;
}

export function PilotForm({ pilot, accounts, fixedHint }: { pilot: PilotLine | null; accounts: { id: string; label: string; hasPilot: boolean }[]; fixedHint: string }) {
  const [state, action, pending] = useActionState(savePilotAction, initial);
  const key = pilot?.id ?? "novo";
  const id = (n: string) => `pilot-${key}-${n}`;
  return (
    <form action={action} aria-label={pilot ? `Piloto ${pilot.account}` : "Novo piloto"} className="flex flex-col gap-2.5">
      <input type="hidden" name="pilot" value={pilot?.id ?? ""} />
      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-5">
        <div className="flex flex-col gap-1">
          <label htmlFor={id("account")} className={label}>
            Conta
          </label>
          {pilot ? (
            <select id={id("account")} className={`${field} font-sans`} disabled defaultValue={pilot.accountId}>
              <option value={pilot.accountId}>{pilot.account}</option>
            </select>
          ) : (
            <select id={id("account")} name="account" className={`${field} font-sans`} required defaultValue="">
              <option value="" disabled>
                Escolha
              </option>
              {accounts
                .filter((a) => !a.hasPilot)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
            </select>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={id("pct")} className={label}>
            Meses 1 e 2: % do creditado
          </label>
          <input id={id("pct")} name="pct" defaultValue={pilot?.pct ?? ""} placeholder="20%" className={field} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={id("cap")} className={label}>
            Teto por mês
          </label>
          <input id={id("cap")} name="cap" defaultValue={pilot?.cap ?? ""} placeholder="[a definir]" className={field} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={id("fixed")} className={label}>
            A partir do mês 3
          </label>
          <input id={id("fixed")} name="fixed" defaultValue={pilot?.fixed ?? ""} placeholder={fixedHint || "[a definir]"} className={field} />
        </div>
        <div className="flex flex-col gap-1">
          <span className={label}>Próxima cobrança</span>
          <span className="flex min-h-10 items-center font-mono" data-testid={`pilot-next-${key}`}>
            {pilot?.next ?? ""}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <div className="flex flex-col gap-1">
          <label htmlFor={id("started")} className={label}>
            Início do piloto
          </label>
          <input id={id("started")} name="started" type="date" defaultValue={pilot?.startedOn ?? ""} className={field} />
        </div>
        <button type="submit" disabled={pending} className={button}>
          Salvar
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function NewPilot({ accounts, fixedHint }: { accounts: { id: string; label: string; hasPilot: boolean }[]; fixedHint: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={button}>
        Novo piloto
      </button>
      {open && (
        <div className="w-full border-t border-border-subtle pt-3">
          <PilotForm pilot={null} accounts={accounts} fixedHint={fixedHint} />
        </div>
      )}
    </>
  );
}

export interface PlanFormRow {
  id: string;
  name: string;
  price: string;
  unit: "kitchen" | "channel_store";
  trialDays: number;
  example: boolean;
}

export function PlanForm({ plan }: { plan: PlanFormRow }) {
  const [state, action, pending] = useActionState(savePlanAction, initial);
  const id = (n: string) => `plan-${plan.id}-${n}`;
  return (
    <form action={action} aria-label={`Plano ${plan.name}`} className="grid grid-cols-1 items-end gap-3 border-t border-border-subtle pt-3 text-sm md:grid-cols-[120px_1fr_1fr_1fr_auto_auto]">
      <input type="hidden" name="plan" value={plan.id} />
      <b className="flex min-h-10 items-center text-base">{plan.name}</b>
      <div className="flex flex-col gap-1">
        <label htmlFor={id("price")} className={label}>
          Preço por mês (R$)
        </label>
        <input id={id("price")} name="price" defaultValue={plan.price} placeholder="a combinar" className={field} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={id("unit")} className={label}>
          Cobrado por
        </label>
        <select id={id("unit")} name="unit" defaultValue={plan.unit} className={`${field} font-sans`}>
          <option value="kitchen">cozinha na análise</option>
          <option value="channel_store">loja de canal</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={id("trial")} className={label}>
          Dias de teste grátis
        </label>
        <input id={id("trial")} name="trial" inputMode="numeric" defaultValue={String(plan.trialDays)} className={field} />
      </div>
      <label className="flex min-h-10 items-center gap-2">
        <input type="checkbox" name="example" defaultChecked={plan.example} />
        preço de exemplo
      </label>
      <div className="flex min-h-10 items-center gap-3">
        <button type="submit" disabled={pending} className={button}>
          Salvar
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}
