"use client";
// One P16/W08 checkbox. A locked e-mail notice is drawn disabled; the server refuses it anyway (E05).
import { useState, useTransition } from "react";
import { setNoticePref } from "@/app/app/notificacoes/actions";

export default function PrefToggle({ code, channel, name, checked, locked, size }: { code: string; channel: "email" | "whatsapp"; name: string; checked: boolean; locked: boolean; size: "sm" | "lg" }) {
  const [on, setOn] = useState(checked);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <input
        type="checkbox"
        checked={on}
        disabled={locked || pending}
        aria-label={`${name} por ${channel === "email" ? "e-mail" : "WhatsApp"}`}
        onChange={(e) => {
          const next = e.target.checked;
          setOn(next);
          start(async () => {
            const r = await setNoticePref(code, channel, next);
            if (!r.ok) {
              setOn(!next);
              setMessage(r.message ?? null);
            } else setMessage(null);
          });
        }}
        className={size === "lg" ? "size-5 justify-self-center" : "size-4.5"}
      />
      {message && (
        <span role="status" className="block text-xs text-danger">
          {message}
        </span>
      )}
    </>
  );
}
