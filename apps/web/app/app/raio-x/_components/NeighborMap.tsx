// P23 "Como fizemos este raio-X", step 1 (Marlon, 08/nov): the radius as a small map. The store at the center, a dot
// per store the run read (monitor_map, the same set as "Lemos N lojas vizinhas"), the radius as a dashed circle. No
// names and no street map: a drawing of the neighborhood, the same on screen and in the PDF.
import type { NeighborMap as MapData } from "@/lib/monitor/load";
import { mapDots } from "@/lib/monitor/view";

const R = 92;

export default function NeighborMap({ map, comp }: { map: MapData; comp: boolean }) {
  const dots = mapDots(map, R);
  const label = `Mapa do raio de ${map.radius_km} km: ${comp ? "a loja dele" : "a sua loja"} no centro e ${dots.length} ${dots.length === 1 ? "loja lida" : "lojas lidas"} em volta.`;
  return (
    <figure className="nmap">
      <svg viewBox="-110 -110 220 220" role="img" aria-label={label}>
        <circle r={R} className="nmap-area" />
        <circle r={R / 2} className="nmap-ring" />
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={3.4} className="nmap-dot" />
        ))}
        <circle r={7} className="nmap-you" />
        <text x={0} y={-R - 6} textAnchor="middle" className="nmap-km">
          {map.radius_km} km
        </text>
      </svg>
      <figcaption>
        <span>{comp ? "No centro, a loja dele." : "No centro, a sua loja."}</span> <span>Cada ponto é uma loja lida.</span>
      </figcaption>
    </figure>
  );
}
