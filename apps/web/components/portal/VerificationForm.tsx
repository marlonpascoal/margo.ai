"use client";
// P17 "Perdi o acesso ao e-mail e ao WhatsApp": asks the founders to verify by CNPJ (04 §8). Not drawn.
import { useState, type FormEvent } from "react";
import { inputClass, postJson, primaryClass } from "./ui";

export default function VerificationForm() {
  const [cnpj, setCnpj] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const r = await postJson("/api/portal/verificacao", { cnpj, contact });
      setMsg({ text: r.message ?? "", ok: r.ok });
    } finally {
      setBusy(false);
    }
  }

  if (msg?.ok) return <p role="status" className="m-0 text-md leading-normal">{msg.text}</p>;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="v-cnpj" className="text-sm font-semibold">
          CNPJ
        </label>
        <input id="v-cnpj" required placeholder="00.000.000/0000-00" value={cnpj} onChange={(e) => setCnpj(e.target.value)} className={`${inputClass} font-mono`} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="v-contact" className="text-sm font-semibold">
          E-mail ou WhatsApp para falarmos com você
        </label>
        <input id="v-contact" required value={contact} onChange={(e) => setContact(e.target.value)} className={inputClass} />
      </div>
      {msg && (
        <p role="status" className="m-0 text-sm text-danger">
          {msg.text}
        </p>
      )}
      <button type="submit" disabled={busy} className={primaryClass}>
        Pedir verificação
      </button>
    </form>
  );
}
