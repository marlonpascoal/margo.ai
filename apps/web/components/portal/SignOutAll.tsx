"use client";
// W09 "Sair de todos os aparelhos" (04 §8): revokes every session of the person (audited in the route).
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignOutAll() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ surface: "portal", all: true }) });
        router.replace("/entrar");
        router.refresh();
      }}
      className="min-h-10 cursor-pointer rounded-md border border-danger bg-surface text-md text-danger disabled:opacity-70"
    >
      Sair de todos os aparelhos
    </button>
  );
}
