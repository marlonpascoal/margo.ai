"use client";
// C03 body, as drawn: map placeholder with the stores, the list with a checkbox per store, and
// "Confirmar N lojas". Counts update as soon as a box changes; each change is saved (reason "manual").
import { useOptimistic, useTransition, type ReactNode } from "react";
import { FictitiousLabel } from "@/components/console";
import { card, primaryButton } from "@/components/xray";
import { kmLabel } from "@/lib/xray/format";
import { mapOffset, neighborhoodCounts, storeState, type NeighborRow } from "@/lib/xray/view";
import { confirmStoresAction, toggleStoreAction } from "../../actions";

const MAP_RADIUS_PX = 170;

export default function NeighborhoodView({
  xrayId,
  title,
  rows,
  target,
  radiusKm,
  synthetic,
}: {
  xrayId: string;
  title: ReactNode;
  rows: NeighborRow[];
  target: { lat: number; lng: number } | null;
  radiusKm: number;
  synthetic: boolean;
}) {
  const [, startTransition] = useTransition();
  const [view, setIncluded] = useOptimistic(rows, (state, change: { id: string; included: boolean }) =>
    state.map((r) => (r.id === change.id ? { ...r, included: change.included, reason: "manual" } : r)),
  );
  const counts = neighborhoodCounts(view);

  function toggle(id: string, included: boolean) {
    startTransition(async () => {
      setIncluded({ id, included });
      await toggleStoreAction(xrayId, id, included);
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        {title}
        <form action={confirmStoresAction} className="flex flex-wrap items-center gap-2.5">
          {synthetic && <FictitiousLabel />}
          <input type="hidden" name="xray" value={xrayId} />
          <button type="submit" className={primaryButton} disabled={counts.inSet === 0}>
            Confirmar {counts.inSet} lojas
          </button>
        </form>
      </div>
      <div className="flex flex-wrap items-start gap-5">
        <div className={`${card} flex flex-[1_1_380px] flex-col gap-3 p-4`}>
          <div className="relative h-[420px] overflow-hidden rounded-md bg-sunken" aria-hidden="true">
            <div className="absolute top-1/2 left-1/2 -mt-[170px] -ml-[170px] h-[340px] w-[340px] rounded-full border-2 border-dashed border-ink-faint" />
            <div className="absolute top-1/2 left-1/2 -mt-[9px] -ml-[9px] h-[18px] w-[18px] rounded-full bg-ink" />
            {target &&
              view.map((r) => {
                if (r.lat === null || r.lng === null) return null;
                const o = mapOffset(target, { lat: r.lat, lng: r.lng }, MAP_RADIUS_PX / radiusKm);
                return (
                  <div
                    key={r.id}
                    className={`absolute h-2.5 w-2.5 rounded-full ${r.included ? "bg-ok" : "bg-danger"}`}
                    style={{ left: `calc(50% + ${o.x.toFixed(1)}px - 5px)`, top: `calc(50% + ${o.y.toFixed(1)}px - 5px)` }}
                  />
                );
              })}
            <div className="absolute bottom-3 left-3 rounded-xs bg-surface px-2 py-1 font-mono text-xs text-ink-muted">mapa: espaço reservado</div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-ink-muted">
            <span>
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-ok" /> no conjunto ({counts.inSet})
            </span>
            <span>
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-danger" /> excluída ({counts.excluded})
            </span>
          </div>
        </div>
        <div className={`${card} flex flex-[1_1_420px] flex-col`}>
          <div className="flex justify-between gap-3 border-b border-border px-4 py-3.5 text-md">
            <b>{counts.found} lojas encontradas</b>
            <span className="text-ink-muted">
              {counts.inSet} no conjunto · {counts.excluded} excluídas
            </span>
          </div>
          <ul className="m-0 max-h-[640px] list-none overflow-y-auto p-0" aria-label="Lojas da vizinhança">
            {view.map((r) => (
              <li key={r.id} data-store={r.name}>
                <label className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-border-subtle px-4 py-2.5 text-md">
                  <input type="checkbox" checked={r.included} onChange={(e) => toggle(r.id, e.target.checked)} aria-label={r.name} />
                  <span>
                    <b>{r.name}</b>
                    <br />
                    <span className="text-xs text-ink-muted">{[r.category, kmLabel(r.distanceM)].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className={`text-right font-mono text-xs ${r.included ? "text-ok" : "text-danger"}`}>{storeState(r)}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
