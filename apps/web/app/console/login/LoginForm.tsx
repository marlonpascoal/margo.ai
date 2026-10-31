"use client";
// C00: e-mail first, then the code that arrived (04 §8). Messages come from the auth API (lib/auth/login.ts).
import { useRef, useState, type FormEvent } from "react";

const inputClass = "box-border min-h-12 rounded-md border border-border-strong bg-surface px-3 text-ink disabled:bg-bg";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  async function post(path: string, body: object) {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; message?: string; next?: string };
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (!sent) {
        const r = await post("/api/auth/code", { email, surface: "console" });
        setMessage(r.message ? { text: r.message, error: !r.ok } : null);
        if (r.ok) {
          setSent(true);
          setTimeout(() => codeRef.current?.focus(), 0);
        }
        return;
      }
      const r = await post("/api/auth/verify", { email, code, surface: "console" });
      if (r.ok) {
        window.location.assign(r.next ?? "/console");
        return;
      }
      setMessage(r.message ? { text: r.message, error: true } : null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="em" className="text-sm font-semibold">
          E-mail de trabalho
        </label>
        <input
          id="em"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setSent(false);
            setCode("");
          }}
          className={`${inputClass} text-base`}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="cd" className="text-sm font-semibold">
          Código que chegou no e-mail
        </label>
        <input
          id="cd"
          ref={codeRef}
          placeholder="000000"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required={sent}
          disabled={!sent}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className={`${inputClass} font-mono text-xl tracking-[0.3em]`}
        />
      </div>
      {message && (
        <p role="status" className={`m-0 text-sm ${message.error ? "text-danger" : "text-ink-muted"}`}>
          {message.text}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="flex min-h-12 cursor-pointer items-center justify-center rounded-lg border-0 bg-ink font-bold text-ink-inverse disabled:opacity-70"
      >
        Entrar
      </button>
    </form>
  );
}
