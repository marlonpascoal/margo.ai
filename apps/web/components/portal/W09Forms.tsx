"use client";
// W09 forms (04 §8, E04, E06): "Trocar" the login e-mail with a code on the new address, "Baixar todos os
// meus dados" and "Excluir a conta e os dados" with a code. The server actions check the profile every call:
// any profile changes its own e-mail; export and deletion are Dono only.
import { useActionState, useState } from "react";
import { confirmDeletion, confirmEmailChange, requestDataExport, sendDeletionCode, sendEmailCode, type W09State } from "@/app/app/seguranca/actions";

const small = "min-h-9 cursor-pointer rounded-sm border border-border-strong bg-surface px-3 text-sm text-ink disabled:cursor-default disabled:opacity-60";
const input = "box-border min-h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-md text-ink";
const wide = "min-h-10 cursor-pointer rounded-md border bg-surface text-md disabled:opacity-60";
const empty: W09State = { message: null };

function Status({ s }: { s: W09State }) {
  if (!s.message) return null;
  return (
    <p role={s.error ? "alert" : "status"} className={`m-0 text-sm leading-normal ${s.error ? "text-danger" : ""}`}>
      {s.message}
    </p>
  );
}

function CodeField({ id }: { id: string }) {
  return (
    <>
      <label htmlFor={id} className="text-sm text-ink-muted">
        Código
      </label>
      <input id={id} name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" pattern="\d{6}" maxLength={6} required className={`${input} font-mono tracking-[0.3em]`} />
    </>
  );
}

/** The e-mail line of "Como você entra" with its "Trocar". */
export function EmailChange({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [sent, send, sending] = useActionState(sendEmailCode, empty);
  const [done, confirm, confirming] = useActionState(confirmEmailChange, empty);
  const target = done.email ?? sent.email;
  return (
    <div className="flex flex-col gap-2 border-t border-border-subtle py-2.5 text-md">
      <div className="flex justify-between gap-3">
        <span>E-mail: {email}</span>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={small}>
          Trocar
        </button>
      </div>
      {open && !(done.message && !done.error) && (
        <>
          <form action={send} className="flex flex-col gap-1.5">
            <label htmlFor="w09-novo-email" className="text-sm text-ink-muted">
              Novo e-mail
            </label>
            <input id="w09-novo-email" name="email" type="email" required defaultValue={target ?? ""} className={input} />
            <button type="submit" disabled={sending} className={small}>
              Mandar código
            </button>
          </form>
          {!target && <Status s={sent} />}
          {target && (
            <form action={confirm} className="flex flex-col gap-1.5">
              <input type="hidden" name="email" value={target} />
              <Status s={done.message ? done : sent} />
              <CodeField id="w09-codigo-email" />
              <button type="submit" disabled={confirming} className={small}>
                Confirmar troca
              </button>
            </form>
          )}
        </>
      )}
      {done.message && !done.error && <Status s={done} />}
    </div>
  );
}

export function ExportButton() {
  const [s, act, busy] = useActionState(requestDataExport, empty);
  return (
    <form action={act} className="flex flex-col gap-1.5">
      <button type="submit" disabled={busy} className={`${wide} w-full border-border-strong text-ink`}>
        Baixar todos os meus dados
      </button>
      <Status s={s} />
    </form>
  );
}

export function DeleteAccount() {
  const [sent, send, sending] = useActionState(sendDeletionCode, empty);
  const [done, confirm, confirming] = useActionState(confirmDeletion, empty);
  if (done.message && !done.error) return <Status s={done} />;
  return (
    <div className="flex flex-col gap-1.5">
      <form action={send}>
        <button type="submit" disabled={sending} className={`${wide} w-full border-danger text-danger`}>
          Excluir a conta e os dados
        </button>
      </form>
      {!sent.email && <Status s={sent} />}
      {sent.email && (
        <form action={confirm} className="flex flex-col gap-1.5">
          <Status s={done.message ? done : sent} />
          <CodeField id="w09-codigo-excluir" />
          <button type="submit" disabled={confirming} className={`${wide} border-danger text-danger`}>
            Confirmar a exclusão
          </button>
        </form>
      )}
    </div>
  );
}
