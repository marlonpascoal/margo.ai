"use client";
// P23 "Compartilhar": "Baixar PDF" only for now (no "Copiar link", Marlon 07/nov). Asks /api/raio-x/[monitor]/pdf for the
// printed copy of this result version; while worker-render prints it, checks again every 3 s, then downloads.
import { useEffect, useRef, useState } from "react";

export const PDF_POLL_MS = 3_000;
const PDF_WAIT_MS = 180_000;

export default function ShareMenu({ monitorId, xrayId }: { monitorId: string; xrayId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "preparing" | "error">("idle");
  const wrap = useRef<HTMLDivElement>(null);
  const url = `/api/raio-x/${monitorId}/pdf?raio-x=${xrayId}`;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  const download = async () => {
    setOpen(false);
    setState("preparing");
    try {
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      let ready = ((await res.json()) as { state: string }).state === "ready";
      const deadline = Date.now() + PDF_WAIT_MS;
      while (!ready && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, PDF_POLL_MS));
        const st = await fetch(`${url}&estado=1`, { cache: "no-store" });
        ready = st.ok && ((await st.json()) as { state: string }).state === "ready";
      }
      if (!ready) throw new Error("timeout");
      setState("idle");
      const a = document.createElement("a");
      a.href = url;
      a.download = "";
      a.click();
    } catch {
      setState("error");
    }
  };

  return (
    <div className="menu share" ref={wrap}>
      <button type="button" className="btn primary" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        Compartilhar
      </button>
      {open ? (
        <ul>
          <li>
            <button type="button" onClick={download}>
              Baixar PDF<small>Os mesmos números desta página</small>
            </button>
          </li>
        </ul>
      ) : null}
      {state !== "idle" ? (
        <p className="xs muted" role="status" style={{ margin: "6px 0 0", position: "absolute", right: 0, whiteSpace: "nowrap" }}>
          {state === "preparing" ? "Preparando o PDF. Leva até 1 minuto." : "Não conseguimos preparar o PDF. Tente de novo."}
        </p>
      ) : null}
    </div>
  );
}
