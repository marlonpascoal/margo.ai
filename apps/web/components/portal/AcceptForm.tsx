"use client";
// P18 "Aceitar e entrar". A WhatsApp invite also asks for the e-mail the person will log in with: login
// codes go by e-mail until the WhatsApp Business Platform (auth.whatsapp_code, D36).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import CodeStep from "./CodeStep";
import { inputClass, postJson, primaryClass } from "./ui";

export default function AcceptForm({ token, askEmail }: { token: string; askEmail: boolean }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<{ email: string; message: string } | null>(null);
  const router = useRouter();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const r = await postJson<{ ok: boolean; message?: string; next?: string; code?: boolean; email?: string }>("/api/portal/convite", { token, name, email, terms });
      if (!r.ok) setError(r.message ?? null);
      else if (r.code) setCode({ email: r.email ?? email, message: r.message ?? "" });
      else window.location.assign(r.next ?? "/app");
    } finally {
      setBusy(false);
    }
  }

  if (code) return <CodeStep email={code.email} sentMessage={code.message} onBack={() => router.push("/entrar")} />;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="nm" className="text-sm font-semibold">
          Seu nome
        </label>
        <input id="nm" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </div>
      {askEmail && (
        <div className="flex flex-col gap-1">
          <label htmlFor="em" className="text-sm font-semibold">
            E-mail
          </label>
          <input id="em" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </div>
      )}
      <label className="flex items-start gap-2.5 text-md leading-[1.45]">
        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 size-4.5" />
        <span>
          Li os <Link href="/termos">termos e a política de privacidade</Link>.
        </span>
      </label>
      {error && (
        <p role="status" className="m-0 text-sm text-danger">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className={primaryClass}>
        Aceitar e entrar
      </button>
    </form>
  );
}
