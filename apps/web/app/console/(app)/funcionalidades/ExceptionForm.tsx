"use client";
// C20 "add an account exception with reason" (05 §A). Not drawn: fields follow the console form style.
import { useActionState } from "react";
import type { AccountOption } from "@/lib/console/features";
import type { FlagEnv, FlagKey } from "@/lib/flags/keys";
import { addExceptionAction, type ExceptionFormState } from "./actions";

const field = "box-border min-h-9 rounded-sm border border-border-strong bg-surface px-2 text-sm text-ink";

export default function ExceptionForm({ flagKey, env, accounts }: { flagKey: FlagKey; env: FlagEnv; accounts: AccountOption[] }) {
  const [state, action, pending] = useActionState<ExceptionFormState, FormData>(addExceptionAction, { message: null });
  const id = (name: string) => `${flagKey}-${name}`;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-ink">Nova exceção</summary>
      <form action={action} className="mt-2 flex flex-col gap-1.5" aria-label={`Nova exceção para ${flagKey}`}>
        <input type="hidden" name="key" value={flagKey} />
        <input type="hidden" name="env" value={env} />
        <label htmlFor={id("account")} className="text-xs text-ink-muted">
          Conta
        </label>
        <select id={id("account")} name="account" className={field} required>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} · {a.name}
            </option>
          ))}
        </select>
        <label htmlFor={id("value")} className="text-xs text-ink-muted">
          Valor
        </label>
        <select id={id("value")} name="value" className={field} defaultValue="true">
          <option value="true">ligada</option>
          <option value="false">desligada</option>
        </select>
        <label htmlFor={id("reason")} className="text-xs text-ink-muted">
          Motivo
        </label>
        <input id={id("reason")} name="reason" className={field} />
        {state.message && (
          <div role="alert" className="text-xs text-danger">
            {state.message}
          </div>
        )}
        <button type="submit" disabled={pending} className="min-h-9 rounded-md bg-ink px-3 text-sm font-semibold text-ink-inverse disabled:opacity-60">
          Salvar exceção
        </button>
      </form>
    </details>
  );
}
