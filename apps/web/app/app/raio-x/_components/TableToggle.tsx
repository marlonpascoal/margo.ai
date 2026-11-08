"use client";
// P24 "Ver como tabela" / "Ver gráfico": every chart has its numbers as a table too.
import { useState, type ReactNode } from "react";

export default function TableToggle({ id, title, sub, extra, chart, table }: { id: string; title: string; sub: string; extra?: ReactNode; chart: ReactNode; table: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="card pad stack" aria-labelledby={id}>
      <div className="row-flex between">
        <div>
          <h2 id={id}>{title}</h2>
          <span className="small muted">{sub}</span>
        </div>
        <div className="row-flex">
          {extra}
          <button type="button" className="linkbtn small" onClick={() => setAsTable(!asTable)}>
            {asTable ? "Ver gráfico" : "Ver como tabela"}
          </button>
        </div>
      </div>
      {asTable ? table : chart}
    </section>
  );
}
