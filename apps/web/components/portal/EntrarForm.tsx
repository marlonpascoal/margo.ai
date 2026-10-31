"use client";
// P15, W06 Entrar: where to send the code, then the code. WhatsApp codes need the WhatsApp Business Platform
// (auth.whatsapp_code, off until D36), so with the flag off only the e-mail field is shown.
import { useState, type FormEvent } from "react";
import CodeStep from "./CodeStep";
import { inputClass, postJson, primaryClass } from "./ui";

export default function EntrarForm({ whatsapp }: { whatsapp: boolean }) {
  const [via, setVia] = useState<"zap" | "mail">(whatsapp ? "zap" : "mail");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const r = await postJson("/api/auth/code", { email, surface: "portal" });
      if (r.ok) setSent(r.message ?? "");
      else setError(r.message ?? null);
    } finally {
      setBusy(false);
    }
  }

  if (sent !== null) return <CodeStep email={email} sentMessage={sent} onBack={() => setSent(null)} />;

  const zap = via === "zap";
  const tab = (on: boolean) => `min-h-10 flex-1 cursor-pointer rounded-md border-0 text-md text-ink ${on ? "bg-surface" : "bg-transparent"}`;
  return (
    <form onSubmit={onSubmit} className="flex max-w-[420px] flex-col gap-3.5">
      {whatsapp && (
        <div className="flex gap-1.5 rounded-lg bg-sunken p-1">
          <button type="button" onClick={() => setVia("zap")} className={tab(zap)} aria-pressed={zap}>
            WhatsApp
          </button>
          <button type="button" onClick={() => setVia("mail")} className={tab(!zap)} aria-pressed={!zap}>
            E-mail
          </button>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor="dest" className="text-sm font-semibold">
          <span className="md:hidden">{zap ? "Seu WhatsApp" : "Seu e-mail"}</span>
          <span className="hidden md:inline">{whatsapp ? "E-mail ou WhatsApp" : "E-mail"}</span>
        </label>
        <input
          id="dest"
          type={zap ? "tel" : "email"}
          required
          autoComplete={zap ? "tel" : "email"}
          placeholder={zap ? "(43) 9 0000-0000" : "voce@restaurante.com.br"}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          className={inputClass}
        />
      </div>
      {error && (
        <p role="status" className="m-0 text-sm text-danger">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className={primaryClass}>
        Mandar código
      </button>
      <span className="hidden text-sm leading-normal text-ink-muted md:block">Sem senha: mandamos um código de 6 números. Vale por 10 minutos.</span>
    </form>
  );
}
