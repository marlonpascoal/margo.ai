"use client";
// P23 "Vou testar" on one item of an own-store run (migration 20261231000008). Marks or unmarks through the audited
// server actions, which check the person again (Dono; Gerente of the monitoring's kitchen). Financeiro sees it disabled.
// With m1.test_max_items marked (full) an unmarked item cannot be added; the server refuses it too.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markTestAction, unmarkTestAction, type ActionResult } from "../actions";

export interface TestButtonProps {
  monitorId: string;
  /** The run shown: the "before" of the test. */
  xrayId: string;
  /** TestPlan.own_item_ids[item_id] of the run. */
  ownItemId: string;
  /** In TestPlan.items. */
  marked: boolean;
  /** canAnswerDoubts (lib/monitor/rules.ts); false for Financeiro: shown, disabled. */
  canEdit: boolean;
  /** TestPlan.active >= TestPlan.max_items. */
  full: boolean;
  /** m1.test_max_items, for the hint when full. */
  maxItems: number;
}

export default function TestButton(p: TestButtonProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const blocked = !p.canEdit || (!p.marked && p.full);
  const hint = !p.canEdit ? "Só quem responde as dúvidas desta loja escolhe os testes." : !p.marked && p.full ? `Você já está testando ${p.maxItems} itens.` : undefined;

  const run = () =>
    start(async () => {
      setError(null);
      const r = await (p.marked ? unmarkTestAction(p.monitorId, p.ownItemId) : markTestAction(p.monitorId, p.xrayId, p.ownItemId)).catch(
        (): ActionResult<void> => ({ ok: false, error: "Não salvou. Tente de novo." }),
      );
      if (!r.ok) setError(r.error);
      router.refresh();
    });

  return (
    <span className="testb no-print">
      <button type="button" className={`btn sm${p.marked ? " on" : ""}`} aria-pressed={p.marked} disabled={blocked || pending} title={hint} onClick={run}>
        {p.marked ? "Testando · Desfazer" : "Vou testar"}
      </button>
      {error ? (
        <span className="errtxt" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
