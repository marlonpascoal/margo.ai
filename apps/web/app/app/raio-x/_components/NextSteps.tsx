// P23 end of page (Marlon, 08/nov: the result is not an end point). "Até o próximo raio-X": the items under test
// (m1.test_max_items) and the next run, which also print; then the links, screen only: follow a competitor (only when the
// plan allows it, monitor_limits.competitor_allowed) and the history.
import Link from "next/link";
import type { MonitorStatus } from "@/lib/monitor/load";
import { nextRunText, testCountLine } from "@/lib/monitor/view";

export interface NextStepsProps {
  monitorId: string;
  targetKind: "own" | "competitor";
  /** TestPlan.active and TestPlan.max_items; ignored for a competitor. */
  testCount: number;
  maxItems: number;
  /** MonitorSummary.next_run_at and status. */
  nextRunAt: string | null;
  status: MonitorStatus;
  /** Limits.competitor_allowed (loadMonitorList). */
  competitorAllowed: boolean;
  mode: "screen" | "print";
}

export default function NextSteps(p: NextStepsProps) {
  const next = nextRunText(p.nextRunAt, p.status);
  const lines = [p.targetKind === "own" ? testCountLine(p.testCount, p.maxItems) : null, next ? `${next}.` : null].filter(Boolean);
  return (
    <section className="card pad stack nexts" aria-labelledby="nsh">
      <h2 id="nsh">Até o próximo raio-X</h2>
      {lines.length ? <p style={{ margin: 0 }}>{lines.join(" ")}</p> : null}
      {p.mode === "screen" ? (
        <div className="row-flex no-print">
          {p.competitorAllowed ? (
            <Link className="btn sm" href="/app/raio-x/novo">
              Acompanhar um concorrente
            </Link>
          ) : null}
          <Link className="btn sm" href={`/app/raio-x/${p.monitorId}/historico`}>
            Ver histórico
          </Link>
        </div>
      ) : null}
    </section>
  );
}
