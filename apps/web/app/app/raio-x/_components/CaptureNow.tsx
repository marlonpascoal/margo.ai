"use client";
// P23 "Capturar agora" (Marlon, 08/nov, no drawing): asks once, then starts a run that reads the whole X-ray again and
// opens P21 to follow it. runMonitorNowAction and monitor_run_now check the person, the flag and the limits on the server.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { runMonitorNowAction, type ActionResult } from "../actions";
import { Toast } from "./Toast";

export default function CaptureNow({ monitorId }: { monitorId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);

  const run = () =>
    start(async () => {
      const r = await runMonitorNowAction(monitorId).catch((): ActionResult<string> => ({ ok: false, error: "Não salvou. Tente de novo." }));
      setOpen(false);
      if (r.ok) router.push(`/app/raio-x/${monitorId}/lendo`);
      else setToast(r.error);
    });

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Capturar agora
      </button>
      <dialog ref={ref} onClose={() => setOpen(false)} className="card pad" style={{ maxWidth: "min(440px, calc(100% - 24px))" }}>
        <form method="dialog" className="stack" onSubmit={(e) => e.preventDefault()}>
          <h2>Capturar agora?</h2>
          <p className="small" style={{ margin: 0 }}>
            Vamos ler de novo o cardápio da loja e das lojas vizinhas e montar um raio-X novo. Leva alguns minutos e dá para pedir uma vez por dia.
          </p>
          <div className="row-flex">
            <button type="button" className="btn primary" disabled={pending} onClick={run}>
              Capturar agora
            </button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancelar
            </button>
          </div>
        </form>
      </dialog>
      <Toast text={toast} onDone={() => setToast(null)} />
    </>
  );
}
