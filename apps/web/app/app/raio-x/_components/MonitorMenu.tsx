"use client";
// P19 row menu (Dono): "Pausar" / "Retomar", "Mudar frequência", "Remover" with confirmation. The server actions check
// manage_monitors and the plan limits again (monitor_set_status, monitor_set_period) and write audit_log.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { setMonitorPeriodAction, setMonitorStatusAction } from "../actions";
import { periodOptions } from "@/lib/monitor/rules";
import type { MonitorStatus } from "@/lib/monitor/load";
import { Toast } from "./Toast";

export default function MonitorMenu({ monitorId, name, status, everyDays, minEveryDays }: { monitorId: string; name: string; status: MonitorStatus; everyDays: number; minEveryDays: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"remove" | "freq" | null>(null);
  const [days, setDays] = useState(Math.max(everyDays, minEveryDays));
  const [toast, setToast] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDialogElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (dialog) ref.current?.showModal();
    else ref.current?.close();
  }, [dialog]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) =>
    start(async () => {
      const r = await fn().catch(() => ({ ok: false, error: "Não salvou. Tente de novo." }));
      setDialog(null);
      setOpen(false);
      setToast(r.ok ? okText : (r.error ?? "Não salvou. Tente de novo."));
      router.refresh();
    });

  return (
    <div className="menu" ref={wrap}>
      <button type="button" className="dots" aria-haspopup="true" aria-expanded={open} aria-label={`Mais ações para ${name}`} onClick={() => setOpen(!open)}>
        ···
      </button>
      {open ? (
        <ul>
          {status === "paused_by_person" ? (
            <li>
              <button type="button" disabled={pending} onClick={() => run(() => setMonitorStatusAction(monitorId, "resume"), `${name}: retomado.`)}>
                Retomar
              </button>
            </li>
          ) : status === "active" ? (
            <li>
              <button type="button" disabled={pending} onClick={() => run(() => setMonitorStatusAction(monitorId, "pause"), `${name}: pausado. Nenhuma leitura até você retomar.`)}>
                Pausar
              </button>
            </li>
          ) : null}
          <li>
            <button type="button" onClick={() => setDialog("freq")}>
              Mudar frequência
            </button>
          </li>
          <li>
            <button type="button" className="danger" onClick={() => setDialog("remove")}>
              Remover
            </button>
          </li>
        </ul>
      ) : null}
      <dialog ref={ref} onClose={() => setDialog(null)} className="card pad" style={{ maxWidth: "min(440px, calc(100% - 24px))" }}>
        {dialog === "remove" ? (
          <form method="dialog" className="stack" onSubmit={(e) => e.preventDefault()}>
            <h2>Remover o acompanhamento?</h2>
            <p className="small" style={{ margin: 0 }}>
              Paramos de ler {name}. O histórico continua guardado.
            </p>
            <div className="row-flex">
              <button type="button" className="btn primary" disabled={pending} onClick={() => run(() => setMonitorStatusAction(monitorId, "remove"), "Removido. O histórico ficou guardado.")}>
                Remover
              </button>
              <button type="button" className="btn" onClick={() => setDialog(null)}>
                Cancelar
              </button>
            </div>
          </form>
        ) : dialog === "freq" ? (
          <form className="stack" onSubmit={(e) => e.preventDefault()}>
            <h2>Com que frequência?</h2>
            <select className="input" aria-label="Com que frequência?" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {periodOptions(minEveryDays).map((p) => (
                <option key={p.days} value={p.days}>
                  {p.label}
                </option>
              ))}
            </select>
            <div className="row-flex">
              <button type="button" className="btn primary" disabled={pending} onClick={() => run(() => setMonitorPeriodAction(monitorId, days), "Frequência salva.")}>
                Salvar
              </button>
              <button type="button" className="btn" onClick={() => setDialog(null)}>
                Cancelar
              </button>
            </div>
          </form>
        ) : null}
      </dialog>
      <Toast text={toast} onDone={() => setToast(null)} />
    </div>
  );
}
