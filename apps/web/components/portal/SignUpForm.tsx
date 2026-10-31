"use client";
// P07 Criar conta (phone) and the Criar conta tab of W06 (computer): same fields, two drawings.
// Creates the account in trial (04 §7) and then asks for the code sent to the e-mail.
import Link from "next/link";
import { useState, type FormEvent } from "react";
import CodeStep from "./CodeStep";
import { inputClass, postJson, primaryClass } from "./ui";

const smallInput = inputClass.replace("min-h-12", "min-h-11");

export default function SignUpForm({ variant, trialDays, xrayRef }: { variant: "phone" | "computer"; trialDays: number; xrayRef: string | null }) {
  const [f, setF] = useState({ name: "", restaurant: "", cnpj: "", whatsapp: "", email: "" });
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const phone = variant === "phone";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const r = await postJson("/api/portal/criar-conta", { ...f, terms, ref: xrayRef });
      if (r.ok) setSent(r.message ?? "");
      else setError(r.message ?? null);
    } finally {
      setBusy(false);
    }
  }

  if (sent !== null) return <CodeStep email={f.email} sentMessage={sent} onBack={() => setSent(null)} />;

  const field = (id: keyof typeof f, label: string, opts: { type?: string; placeholder?: string; mono?: boolean; wide?: boolean; autoComplete?: string } = {}) => (
    <div key={id} className={`flex flex-col gap-1 ${opts.wide && !phone ? "col-span-2" : ""}`}>
      <label htmlFor={`su-${id}`} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={`su-${id}`}
        type={opts.type ?? "text"}
        placeholder={opts.placeholder}
        autoComplete={opts.autoComplete}
        required={id !== "whatsapp"}
        value={f[id]}
        onChange={(e) => {
          setF({ ...f, [id]: e.target.value });
          setError(null);
        }}
        className={`${smallInput} ${opts.mono ? "font-mono" : ""}`}
      />
    </div>
  );

  const fields = phone
    ? [
        field("name", "Seu nome", { autoComplete: "name" }),
        field("restaurant", "Restaurante", { autoComplete: "organization" }),
        field("cnpj", "CNPJ da loja", { placeholder: "00.000.000/0000-00", mono: true }),
        field("whatsapp", "WhatsApp", { type: "tel", placeholder: "(43) 9 0000-0000", autoComplete: "tel" }),
        field("email", "E-mail", { type: "email", autoComplete: "email" }),
      ]
    : [
        field("name", "Seu nome", { autoComplete: "name" }),
        field("restaurant", "Grupo ou restaurante", { autoComplete: "organization" }),
        field("email", "E-mail", { type: "email", autoComplete: "email" }),
        field("whatsapp", "WhatsApp", { type: "tel", autoComplete: "tel" }),
        field("cnpj", "CNPJ principal", { mono: true, wide: true }),
      ];

  return (
    <form onSubmit={onSubmit} className={phone ? "flex flex-col gap-3" : "grid max-w-[520px] grid-cols-2 gap-3"}>
      {fields}
      <label className={`flex items-start gap-2.5 text-md leading-[1.45] ${phone ? "" : "col-span-2"}`}>
        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 size-4.5" />
        <span>
          Li e aceito os <Link href="/termos">termos e a política de privacidade</Link>.
        </span>
      </label>
      {error && (
        <p role="status" className={`m-0 text-sm text-danger ${phone ? "" : "col-span-2"}`}>
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className={`${primaryClass} ${phone ? "" : "col-span-2"}`}>
        {phone ? `Começar meus ${trialDays} dias grátis` : "Começar o teste grátis"}
      </button>
    </form>
  );
}
