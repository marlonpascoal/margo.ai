// P23 "Seus testes" (Marlon, 08/nov): the items the owner marked "Vou testar" in this monitoring, each with what it was
// when marked and what this run says now (own price, M1-05 middle, M1-07 reading, M1-10 position among the stores
// selling it). Nothing marked: the invitation. Own-store runs only (a competitor's price is not the owner's to change).
import type { TestPlan as Plan } from "@/lib/monitor/load";
import { testChangeSentence, testPositionChange } from "@/lib/monitor/view";
import TestButton from "./TestButton";

export interface TestPlanProps {
  plan: Plan | null;
  monitorId: string;
  /** canAnswerDoubts (lib/monitor/rules.ts): shows "Testando · Desfazer" enabled. */
  canEdit: boolean;
  mode: "screen" | "print";
}

export default function TestPlan({ plan, monitorId, canEdit, mode }: TestPlanProps) {
  if (!plan || plan.target_kind !== "own") return null;
  const print = mode === "print";
  if (!plan.items.length && print) return null;
  return (
    <section className="card pad stack testp" aria-labelledby="testh">
      <h2 id="testh">Seus testes</h2>
      {plan.items.length ? (
        <ul className="testl">
          {plan.items.map((t) => {
            const pos = testPositionChange(t);
            return (
              <li key={t.test_id} data-item={t.name ?? undefined}>
                <div className="stack" style={{ gap: 2 }}>
                  <b>{t.name}</b>
                  <span className="small">{testChangeSentence(t)}</span>
                  {pos ? <span className="xs muted">{pos}</span> : null}
                </div>
                {print ? null : <TestButton monitorId={monitorId} xrayId={plan.xray_id} ownItemId={t.own_item_id} marked canEdit={canEdit} full={plan.active >= plan.max_items} maxItems={plan.max_items} />}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          Escolha até {plan.max_items} itens para testar até o próximo raio-X. Mude o preço de um deles no iFood e veja aqui o que aconteceu.
        </p>
      )}
    </section>
  );
}
