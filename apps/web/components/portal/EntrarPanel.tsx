"use client";
// W06 right side: Entrar and Criar conta tabs on computer. On phone (P15) only Entrar shows; Criar conta is
// its own page (P07).
import { useState } from "react";
import EntrarForm from "./EntrarForm";
import SignUpForm from "./SignUpForm";

export default function EntrarPanel({ whatsapp, trialDays }: { whatsapp: boolean; trialDays: number }) {
  const [tab, setTab] = useState<"login" | "signup">("login");
  const cls = (on: boolean) => `min-h-11 flex-1 cursor-pointer rounded-md border-0 text-base text-ink ${on ? "bg-surface" : "bg-transparent"}`;
  return (
    <>
      <div role="tablist" className="hidden max-w-[420px] gap-1.5 rounded-lg bg-sunken p-1 md:flex">
        <button type="button" role="tab" aria-selected={tab === "login"} onClick={() => setTab("login")} className={cls(tab === "login")}>
          Entrar
        </button>
        <button type="button" role="tab" aria-selected={tab === "signup"} onClick={() => setTab("signup")} className={cls(tab === "signup")}>
          Criar conta
        </button>
      </div>
      {tab === "login" ? <EntrarForm whatsapp={whatsapp} /> : <SignUpForm variant="computer" trialDays={trialDays} xrayRef={null} />}
    </>
  );
}
