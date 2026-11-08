"use client";
// P22 interactive part: doubts by category with the suggestion pre-marked, "Confirmar todas as sugestões", bulk
// selection with a sticky bar, per item answer and undo, then "Itens só seus" and "Confirmados pelo sistema" collapsed
// by category. Every answer goes through an audited server action (monitor_answer*, monitor_undo) and recalculates.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { Doubt, Doubts, ItemLists } from "@/lib/monitor/load";
import { doubtReason } from "@/lib/monitor/rules";
import { brl, byGroup, selectedLabel } from "@/lib/monitor/view";
import { answerDoubtAction, answerManyAction, confirmSuggestionsAction, undoAnswerAction, type ActionResult } from "../actions";
import { Toast } from "./Toast";

const suggestedOf = (d: Doubt) => d.candidates.filter((c) => c.suggested).map((c) => c.pair_id);

export default function Revisar({ monitorId, xrayId, doubts, lists, canAnswer }: { monitorId: string; xrayId: string; doubts: Doubts; lists: ItemLists; canAnswer: boolean }) {
  const router = useRouter();
  const open = useMemo(() => doubts.items.filter((d) => !d.answered), [doubts.items]);
  const [marks, setMarks] = useState<Record<string, string[]>>(() => Object.fromEntries(open.map((d) => [d.item_id, suggestedOf(d)])));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ro = !canAnswer;

  const markOf = (d: Doubt) => marks[d.item_id] ?? suggestedOf(d);
  const changed = (d: Doubt) => markOf(d).slice().sort().join() !== suggestedOf(d).slice().sort().join();

  const act = (fn: () => Promise<ActionResult<void>>, ok: string, clear: string[] = []) =>
    start(async () => {
      setError(null);
      const r = await fn().catch((): ActionResult<void> => ({ ok: false, error: "Não salvou. Tente de novo." }));
      if (r.ok) {
        setToast(ok);
        setSel((s) => new Set([...s].filter((id) => !clear.includes(id))));
      } else setError(r.error);
      router.refresh();
    });

  /** The marks as they stand: the server's suggestion when unchanged, else the owner's marks. */
  const confirm = (items: Doubt[], okText: string) => {
    const ids = items.map((d) => d.item_id);
    if (items.every((d) => !changed(d))) act(() => confirmSuggestionsAction(xrayId, items.length === open.length ? null : ids), okText, ids);
    else act(() => answerManyAction(xrayId, items.map((d) => ({ itemId: d.item_id, acceptedPairIds: markOf(d) }))), okText, ids);
  };

  const selected = open.filter((d) => sel.has(d.item_id));
  const toggleMark = (d: Doubt, pairId: string, on: boolean) => setMarks((m) => ({ ...m, [d.item_id]: on ? [...markOf(d), pairId] : markOf(d).filter((x) => x !== pairId) }));
  const toggleSel = (id: string, on: boolean) => setSel((s) => (on ? new Set([...s, id]) : new Set([...s].filter((x) => x !== id))));

  const doubtRow = (d: Doubt) => {
    if (d.answered) {
      const yes = d.candidates.some((c) => c.accepted);
      return (
        <div className="doubt" key={d.item_id} data-item={d.name}>
          <span />
          <div className="answered">
            <b>{d.name}</b>
            <span className={`pill ${yes ? "p-ok" : "p-off"}`}>{yes ? "é o mesmo" : "nenhum é o mesmo"}</span>
            {d.answered_by_staff ? <span className="xs muted">respondido pela equipe MargoAI</span> : null}
            {ro ? null : (
              <button type="button" className="linkbtn small" disabled={pending} onClick={() => act(() => undoAnswerAction(d.item_id), "Resposta desfeita. Recalculando o raio-X.")}>
                Desfazer
              </button>
            )}
          </div>
        </div>
      );
    }
    const m = markOf(d);
    const none = m.length === 0;
    return (
      <div className={`doubt${sel.has(d.item_id) ? " sel" : ""}`} key={d.item_id} data-item={d.name}>
        <input type="checkbox" checked={sel.has(d.item_id)} disabled={ro} aria-label={`Selecionar ${d.name}`} onChange={(e) => toggleSel(d.item_id, e.target.checked)} />
        <div>
          <div className="own">
            <b>{d.name}</b>
            <span className="mono">{brl(d.own_cents)}</span>
          </div>
          <div className="q">É o mesmo produto que o seu?</div>
          <div className="reason">{doubtReason(d.pair_note, d.stores)}.</div>
          <div className="cands">
            {d.candidates.map((c) => (
              <label key={c.pair_id} className={`cand${m.includes(c.pair_id) ? " on" : ""}`}>
                <input type="checkbox" checked={m.includes(c.pair_id)} disabled={ro} onChange={(e) => toggleMark(d, c.pair_id, e.target.checked)} />
                <span>
                  {c.name}
                  <small>{c.store ?? "Loja vizinha"}</small>
                </span>
                <span className="pr">{brl(c.price_cents)}</span>
              </label>
            ))}
          </div>
          <div className="sugg">{none ? "Sugestão: nenhum é o mesmo" : changed(d) ? "Marcado por você" : "Sugestão marcada"}</div>
          {ro ? null : (
            <div className="dact">
              <button type="button" className="btn sm" disabled={none || pending} onClick={() => act(() => answerDoubtAction(d.item_id, m), `${d.name}: confirmado.`, [d.item_id])}>
                Sim, é o mesmo
              </button>
              <button type="button" className="btn sm" disabled={pending} onClick={() => act(() => answerDoubtAction(d.item_id, []), `${d.name}: nenhum é o mesmo.`, [d.item_id])}>
                Nenhum é o mesmo
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const list = (
    <section className="card" aria-label="Itens em dúvida">
      <div className="ghead">
        <label className="chk" style={{ fontWeight: 600 }}>
          <input
            type="checkbox"
            disabled={ro || open.length === 0}
            checked={open.length > 0 && open.every((d) => sel.has(d.item_id))}
            onChange={(e) => setSel(e.target.checked ? new Set(open.map((d) => d.item_id)) : new Set())}
          />{" "}
          Selecionar todos
        </label>
        <span className="small muted">{open.length} em dúvida</span>
      </div>
      {byGroup(doubts.items).map((g) => {
        const ids = g.rows.filter((d) => !d.answered).map((d) => d.item_id);
        return (
        <div key={g.group}>
          <div className="catgh">
            <label className="chk">
              <GroupCheck
                ids={ids}
                sel={sel}
                disabled={ro || ids.length === 0}
                label={`Selecionar todos em ${g.label}`}
                onChange={(on) => setSel((s) => (on ? new Set([...s, ...ids]) : new Set([...s].filter((x) => !ids.includes(x)))))}
              />{" "}
              {g.label}
            </label>
            <span>{ids.length} em dúvida</span>
          </div>
          {g.rows.map(doubtRow)}
        </div>
        );
      })}
    </section>
  );

  const nothing = doubts.open === 0 && doubts.answered === 0;
  const done = doubts.open === 0 && doubts.answered > 0;

  return (
    <div className="rx-review stack" style={{ gap: 20 }}>
      {error ? (
        <div className="banner badb" role="alert">
          <span>{error === "Não salvou. Tente de novo." ? "Não salvou. Suas respostas não mudaram. Tente de novo." : error}</span>
        </div>
      ) : null}
      {ro ? (
        <div className="banner neutral">
          <span>Só o Dono e o Gerente da cozinha respondem. Você pode ver as dúvidas.</span>
        </div>
      ) : null}
      {nothing ? (
        <div className="banner okb">
          <span>
            <b>Nada em dúvida.</b> O sistema confirmou os {doubts.auto_confirmed} itens comparáveis sozinho.
          </span>
          <Link className="btn sm" href={`/app/raio-x/${monitorId}`}>
            Ver resultado
          </Link>
        </div>
      ) : done ? (
        <>
          <div className="banner okb" role="status">
            <span>
              <b>Pronto.</b> Seu raio-X foi atualizado com as suas respostas.
            </span>
            <Link className="btn primary sm" href={`/app/raio-x/${monitorId}`}>
              Ver resultado
            </Link>
          </div>
          <div className="card pad small muted">Suas respostas valem para os próximos raio-X desta loja. Dá para mudar a qualquer momento: use Desfazer.</div>
          {list}
        </>
      ) : !doubts.asked ? (
        <>
          <div className="banner neutral">
            <span>Num raio-X de concorrente não perguntamos as dúvidas: o resultado sai sem estes {doubts.open} itens.</span>
          </div>
          <details className="card coll">
            <summary>
              <span>
                <b>Revisar mesmo assim ({doubts.open})</b>
              </span>
            </summary>
            {list}
          </details>
        </>
      ) : (
        <>
          <section className="card hero" aria-label="Resumo">
            <div>
              <h2 style={{ fontSize: 20 }}>
                O sistema confirmou {doubts.auto_confirmed} itens iguais sozinho. Ficou em dúvida em {open.length}.
              </h2>
              <p className="small muted" style={{ margin: "6px 0 0" }}>
                Em cada um já deixamos marcada a nossa sugestão. Se estiver tudo certo, confirme de uma vez.
              </p>
            </div>
            {ro ? null : (
              <button type="button" className="btn primary" disabled={pending} onClick={() => confirm(open, "Sugestões confirmadas. Recalculando o raio-X.")}>
                Confirmar todas as sugestões ({open.length})
              </button>
            )}
          </section>
          {list}
        </>
      )}

      {lists.only_yours.length ? (
        <details className="card coll">
          <summary>
            <span>
              <b>Itens só seus ({lists.only_yours.length})</b> <span className="small muted">Ninguém por perto vende algo igual. Nada a fazer.</span>
            </span>
          </summary>
          <div className="body">
            {lists.only_yours.map((i) => (
              <div key={i.item_id}>
                <span>{i.name}</span>
                <span className="small muted">só seu</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {lists.confirmed.filter((c) => c.by_system).length ? (
        <details className="card coll">
          <summary>
            <span>
              <b>Confirmados pelo sistema ({lists.confirmed.filter((c) => c.by_system).length})</b> <span className="small muted">Mesmo produto, tamanho e sabor.</span>
            </span>
          </summary>
          <div className="body">
            {byGroup(lists.confirmed.filter((c) => c.by_system)).map((g) => (
              <ConfirmedGroup key={g.group} label={g.label} rows={g.rows} ro={ro} pending={pending} onSave={(id, keep, name) => act(() => answerDoubtAction(id, keep), `${name}: salvo. Recalculando o raio-X.`)} />
            ))}
          </div>
        </details>
      ) : null}

      {!ro && sel.size > 0 ? (
        <div className="bulk" role="region" aria-label="Ações nos selecionados">
          <span className="count">{selectedLabel(sel.size)}</span>
          <button type="button" className="main" disabled={pending} onClick={() => confirm(selected, `${selected.length} confirmados.`)}>
            Confirmar sugestões dos selecionados
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => act(() => answerManyAction(xrayId, selected.map((d) => ({ itemId: d.item_id, acceptedPairIds: [] }))), `${selected.length} marcados como diferentes.`, selected.map((d) => d.item_id))}
          >
            Nenhum é o mesmo
          </button>
          <button type="button" onClick={() => setSel(new Set())}>
            Limpar
          </button>
        </div>
      ) : !ro && open.length && doubts.asked ? (
        <div className="bulk phone-only" role="region" aria-label="Confirmar">
          <button type="button" className="main" style={{ flex: "1 1 100%", minHeight: 48 }} disabled={pending} onClick={() => confirm(open, "Sugestões confirmadas. Recalculando o raio-X.")}>
            Confirmar todas as sugestões ({open.length})
          </button>
        </div>
      ) : null}
      <Toast text={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function ConfirmedGroup({ label, rows, ro, pending, onSave }: { label: string; rows: ItemLists["confirmed"]; ro: boolean; pending: boolean; onSave: (itemId: string, keep: string[], name: string) => void }) {
  return (
    <>
      <div className="covh">{label}</div>
      {rows.map((r) => (
        <ConfirmedRow key={r.item_id} r={r} ro={ro} pending={pending} onSave={onSave} />
      ))}
    </>
  );
}

/** "Não é o mesmo": the accepted stores of a system-confirmed item; unmark the ones that are not the same. */
function ConfirmedRow({ r, ro, pending, onSave }: { r: ItemLists["confirmed"][number]; ro: boolean; pending: boolean; onSave: (itemId: string, keep: string[], name: string) => void }) {
  const [openRow, setOpenRow] = useState(false);
  const [keep, setKeep] = useState(r.accepted.map((a) => a.pair_id));
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div className="row-flex between">
        <span>
          {r.name} <span className="small muted">· {r.accepted.length} {r.accepted.length === 1 ? "loja" : "lojas"}</span>
        </span>
        {ro ? null : (
          <button type="button" className="linkbtn small" aria-expanded={openRow} onClick={() => setOpenRow(!openRow)}>
            Não é o mesmo
          </button>
        )}
      </div>
      {openRow ? (
        <div className="cands" style={{ marginTop: 0 }}>
          {r.accepted.map((a) => (
            <label key={a.pair_id} className={`cand${keep.includes(a.pair_id) ? " on" : ""}`}>
              <input type="checkbox" checked={keep.includes(a.pair_id)} onChange={(e) => setKeep(e.target.checked ? [...keep, a.pair_id] : keep.filter((x) => x !== a.pair_id))} />
              <span>
                {a.name}
                <small>{a.store ?? "Loja vizinha"}</small>
              </span>
              <span className="pr">{brl(a.price_cents)}</span>
            </label>
          ))}
          <div className="row-flex">
            <span className="xs muted">Desmarque as lojas cujo item não é o mesmo que o seu.</span>
            <button type="button" className="btn sm" disabled={pending} onClick={() => onSave(r.item_id, keep, r.name)}>
              Salvar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** P22 category header: selects every open doubt of the group; indeterminate when only some are selected. */
function GroupCheck({ ids, sel, disabled, label, onChange }: { ids: string[]; sel: Set<string>; disabled: boolean; label: string; onChange: (on: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const n = ids.filter((id) => sel.has(id)).length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = n > 0 && n < ids.length;
  }, [n, ids.length]);
  return <input ref={ref} type="checkbox" aria-label={label} disabled={disabled} checked={ids.length > 0 && n === ids.length} onChange={(e) => onChange(e.target.checked)} />;
}
