"use client";
// C06 "A mensagem" and the hours, as drawn. "Enviar pelo WhatsApp" opens click-to-chat with the text in a
// new tab (manual send, D36) and records the delivery; "Salvar e voltar" saves the hours and goes to C01.
import { useActionState, useRef, useTransition } from "react";
import { card, primaryButton, secondaryButton } from "@/components/xray";
import { whatsappLink } from "@/lib/xray/P02-whatsapp-raio-x";
import { deliverAction, saveHoursAction, type HoursState } from "../../actions";

const hourField = "box-border min-h-10 rounded-sm border border-border-strong bg-surface px-2.5 font-mono text-md text-ink";

export default function DeliveryForm({ xrayId, message, hours }: { xrayId: string; message: string; hours: Record<"vizinhanca" | "pareamento" | "entrega", string> }) {
  const text = useRef<HTMLTextAreaElement>(null);
  const [sending, startSending] = useTransition();
  const [state, save, saving] = useActionState<HoursState, FormData>(saveHoursAction, { message: null });

  function send() {
    const body = text.current?.value ?? message;
    window.open(whatsappLink(body), "_blank", "noopener");
    const form = new FormData();
    form.set("xray", xrayId);
    form.set("mensagem", body);
    startSending(() => deliverAction(form));
  }

  return (
    <form action={save} className={`${card} flex flex-[2_1_420px] flex-col gap-3 p-4`}>
      <input type="hidden" name="xray" value={xrayId} />
      <div className="font-bold">A mensagem</div>
      <label htmlFor="msg" className="text-sm text-ink-muted">
        Texto que vai junto, no WhatsApp do fundador
      </label>
      <textarea
        ref={text}
        id="msg"
        name="mensagem"
        rows={7}
        defaultValue={message}
        className="resize-y rounded-md border border-border-strong p-3 font-sans text-md leading-normal text-ink"
      />
      <div className="flex flex-wrap gap-2.5">
        <button type="button" onClick={send} disabled={sending} className={primaryButton}>
          Enviar pelo WhatsApp
        </button>
        <button type="submit" disabled={saving} className={secondaryButton}>
          Salvar e voltar
        </button>
      </div>
      {state.message && (
        <div role="alert" className="text-sm text-danger">
          {state.message}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 border-t border-border-subtle pt-3 sm:grid-cols-3">
        {(
          [
            ["h1", "vizinhanca", "Horas: vizinhança"],
            ["h2", "pareamento", "Horas: pareamento"],
            ["h3", "entrega", "Horas: entrega"],
          ] as const
        ).map(([id, step, label]) => (
          <div key={id} className="flex flex-col gap-1">
            <label htmlFor={id} className="text-xs text-ink-muted">
              {label}
            </label>
            <input id={id} name={step} defaultValue={hours[step]} inputMode="decimal" className={hourField} />
          </div>
        ))}
      </div>
    </form>
  );
}
