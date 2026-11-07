"use client";
// "Sair": ends this session only (04 §8, audited in the route). Not drawn in Menu or MenuDono; see docs/build-review.md.
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignOut({ surface, className }: { surface: "console" | "portal"; className: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ surface }) });
        router.replace(surface === "console" ? "/console/login" : "/entrar");
        router.refresh();
      }}
      className={className}
    >
      Sair
    </button>
  );
}
