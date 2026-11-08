// P23 / W14 "Oportunidades" (Marlon, 08/nov; no drawing): AI opportunities of an own run, written by worker-collector
// (job xray_opportunities) on top of the deterministic rules M1-05 to M1-12, and kept only when every number in them
// exists in the run's facts. Same block on screen and in the printed copy. Nothing for a competitor's run, for a run
// without opportunities, or when every answer failed the check.
import type { OpportunityLever, Opportunities as OpportunitiesData } from "@/lib/monitor/load";

const LEVER_LABEL: Record<OpportunityLever, string> = {
  subir_preco: "Subir preço",
  manter: "Manter",
  rever_custo: "Rever custo",
  acompanhar: "Acompanhar",
};

export interface OpportunitiesProps {
  data: OpportunitiesData | null;
  competitor: boolean;
}

export default function Opportunities({ data, competitor }: OpportunitiesProps) {
  if (competitor || !data || data.items.length === 0) return null;
  return (
    <section className="card opps" aria-labelledby="opph">
      <div className="opph">
        <p className="eyebrow" id="opph">
          Oportunidades
        </p>
        <p className="oppnote">Sugestão gerada por IA a partir dos números deste raio-X. Confira antes de mudar preços.</p>
      </div>
      <ol className="opplist">
        {data.items.map((o) => (
          <li key={o.rank} className={`opp lv-${o.lever}`}>
            <span className="oppn mono" aria-hidden="true">
              {o.rank}
            </span>
            <div className="oppb">
              <div className="oppt">
                <h3>{o.title}</h3>
                <span className="opplv">{LEVER_LABEL[o.lever] ?? o.lever}</span>
              </div>
              <p className="oppwhy">{o.why}</p>
              {o.items.length ? (
                <ul className="oppitems" aria-label="Itens">
                  {o.items.map((it) => (
                    <li key={it.item_id}>{it.name}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
