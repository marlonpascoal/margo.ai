"use client";
// P15 step 2: the code that arrived, then the portal (04 §8: 6 digits, 10 minutes, 5 tries).
import { useEffect, useRef, useState, type FormEvent } from "react";
import { inputClass, labelClass, postJson, primaryClass } from "./ui";

export default function CodeStep({ email, sentMessage, onBack }: { email: string; sentMessage: string; onBack: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const r = await postJson("/api/auth/verify", { email, code, surface: "portal" });
      if (r.ok) {
        window.location.assign(r.next ?? "/app");
        return;
      }
      setError(r.message ?? null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <p role="status" className={`m-0 text-base leading-normal ${error ? "text-danger" : ""}`}>
        {error ?? sentMessage}
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor="cod" className={labelClass}>
          Código
        </label>
        <input
          id="cod"
          ref={ref}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          pattern="\d{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className={`${inputClass} min-h-13 font-mono text-2xl tracking-[0.3em]`}
        />
      </div>
      <button type="submit" disabled={busy} className={primaryClass}>
        Entrar
      </button>
      <button type="button" onClick={onBack} className="min-h-10 cursor-pointer border-0 bg-transparent text-md text-ink underline">
        Usar outro número ou e-mail
      </button>
    </form>
  );
}
