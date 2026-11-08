"use client";
// P20 form: own store or competitor, both by the iFood link (D29; Marlon 08/nov: only iFood for now), kitchen for a
// competitor when the account has more than one, period (only values at or above the plan minimum), radius
// (M1-01), comparison settings (M1-02, C02 defaults). "Começar a acompanhar" creates the monitoring and its first run,
// then opens P21.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { storeIdFromUrl } from "@/lib/xray/ifood-url";
import { categoryOptionFor, CATEGORY_OPTIONS, RADIUS_OPTIONS } from "@/lib/xray/labels";
import { createMonitorAction, lookupStoreAction, type StoreLookup } from "../actions";

interface Props {
  kitchens: { id: string; name: string }[];
  periods: { days: number; label: string }[];
  competitorAllowed: boolean;
  competitorFull: boolean;
  competitorMax: number;
  competitorLeftMonth: number;
  ownFull: boolean;
  ownMax: number | null;
  plan: string;
}

export default function NovoForm(p: Props) {
  const router = useRouter();
  const [kind, setKind] = useState<"own" | "comp">("own");
  const [url, setUrl] = useState("");
  const [looked, setLooked] = useState<{ url: string; r: StoreLookup } | null>(null);
  const [kitchen, setKitchen] = useState(p.kitchens[0]?.id ?? "");
  const [days, setDays] = useState(p.periods[0]?.days ?? 7);
  const [radius, setRadius] = useState<2 | 3 | 5>(3);
  const [chosenCats, setChosenCats] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [rules, setRules] = useState({ exclude_closed: true, exclude_national_chains: true, same_neighborhood_only: false });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const comp = kind === "comp";
  const validUrl = storeIdFromUrl(url) !== null;
  useEffect(() => {
    if (!validUrl) return;
    let live = true;
    lookupStoreAction(url).then((r) => live && setLooked({ url, r }));
    return () => {
      live = false;
    };
  }, [url, validUrl]);
  const found: StoreLookup | null = !url ? null : !validUrl ? { state: "invalid" } : looked?.url === url ? looked.r : null;
  const full = comp ? p.competitorFull : p.ownFull;

  // D71: the store's own cuisine when the catalog knows it; otherwise the person chooses, never a silent burger default.
  const cats = chosenCats ?? (found?.state === "found" || found?.state === "own" ? categoryOptionFor(found.category) : null) ?? "";
  const needsCats = found !== null && found.state !== "invalid" && !cats;

  const blocked = (comp ? p.competitorFull || !p.competitorAllowed : p.ownFull) || !validUrl || !cats;
  const categories = [...(CATEGORY_OPTIONS.find((c) => c.value === cats)?.categories ?? [])];

  const submit = () =>
    start(async () => {
      setError(null);
      const common = { everyDays: days, radiusKm: radius, categories, rules };
      const call = createMonitorAction({ url, kind: comp ? "competitor" : "own", kitchenId: comp && found?.state !== "own" ? kitchen || null : null, ...common });
      const r = await call.catch(() => ({ ok: false as const, error: "Não salvou. Tente de novo." }));
      if (r.ok && r.value) router.push(`/app/raio-x/${r.value.monitorId}/lendo`);
      else if (!r.ok) setError(r.error);
    });

  const cost = comp
    ? p.competitorFull
      ? "Sem vaga para concorrente agora."
      : `Conta como 1 dos ${p.competitorMax} concorrentes do seu plano. ${p.competitorLeftMonth === 1 ? "Resta 1 novo" : `Restam ${p.competitorLeftMonth} novos`} este mês.`
    : p.plan === "raio_x"
      ? "No plano grátis, 1 loja sua a cada 3 meses."
      : "Suas lojas estão incluídas no plano Lucro.";

  return (
    <form
      className="card pad stack"
      style={{ maxWidth: 760, gap: 20 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!blocked) submit();
      }}
    >
      <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <legend className="legend" style={{ marginBottom: 8 }}>
          Qual loja?
        </legend>
        <div className="choice">
          <label>
            <input type="radio" name="k" value="own" checked={!comp} onChange={() => setKind("own")} />
            <b>Uma loja minha</b>
            <span>{p.ownFull ? `Seu plano acompanha ${p.ownMax === 1 ? "uma loja sua" : `${p.ownMax} lojas suas`}.` : "Cole o link da sua loja no iFood."}</span>
          </label>
          <label>
            <input type="radio" name="k" value="comp" checked={comp} disabled={!p.competitorAllowed} onChange={() => setKind("comp")} />
            <b>Um concorrente</b>
            <span>{!p.competitorAllowed ? "Concorrentes fazem parte do plano Lucro." : p.competitorFull ? `Você já acompanha ${p.competitorMax} de ${p.competitorMax}.` : "Cole o link da loja no iFood."}</span>
          </label>
        </div>
      </fieldset>

      {comp && p.competitorFull ? (
        <div className="banner">
          <span>Seu plano permite {p.competitorMax} concorrentes ao mesmo tempo. Pause ou remova um, ou veja os planos.</span>
          <Link className="btn sm" href="/app/raio-x">
            Ver meus concorrentes
          </Link>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="url">{comp ? "Link da loja no iFood" : "Link da sua loja no iFood"}</label>
        <input id="url" className="input url" type="url" value={url} disabled={full} onChange={(e) => { setUrl(e.target.value); setChosenCats(null); }} placeholder="https://www.ifood.com.br/delivery/..." aria-describedby="url-help" />
        <span id="url-help" aria-live="polite">
          {found?.state === "invalid" ? (
            <span className="errtxt" role="alert">
              Este link não é de uma loja do iFood. Abra a loja no iFood e copie o endereço.
            </span>
          ) : found?.state === "found" ? (
            <span className="found">Loja encontrada: {[found.name, found.area, found.category].filter(Boolean).join(" · ")}</span>
          ) : found?.state === "own" ? (
            <span className="found">Esta loja é sua: {found.name}.</span>
          ) : null}
        </span>
      </div>
      {comp && found?.state !== "own" && p.kitchens.length > 1 ? (
        <div className="field">
          <label htmlFor="coz">Perto de qual cozinha?</label>
          <select id="coz" className="input" value={kitchen} disabled={p.competitorFull} onChange={(e) => setKitchen(e.target.value)}>
            {p.kitchens.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="grid2">
        <div className="field">
          <label htmlFor="freq">Com que frequência?</label>
          <select id="freq" className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {p.periods.map((x) => (
              <option key={x.days} value={x.days}>
                {x.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="raio">Raio da vizinhança</label>
          <select id="raio" className="input" value={radius} onChange={(e) => setRadius(Number(e.target.value) as 2 | 3 | 5)}>
            {RADIUS_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <details open={adjustOpen || needsCats} onToggle={(e) => setAdjustOpen(e.currentTarget.open)}>
        <summary>Ajustes da comparação</summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="cat">Categorias que contam como concorrente</label>
            <select id="cat" className="input" value={cats} onChange={(e) => setChosenCats(e.target.value)} aria-describedby="cat-help">
              {!cats ? (
                <option value="" disabled>
                  Escolha a cozinha
                </option>
              ) : null}
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            {needsCats ? <span id="cat-help">Escolha a cozinha da loja: ela define quem conta como concorrente.</span> : null}
          </div>
          <label className="chk">
            <input type="checkbox" checked={rules.exclude_closed} onChange={(e) => setRules({ ...rules, exclude_closed: e.target.checked })} /> Deixar de fora lojas fechadas há mais de 30 dias
          </label>
          <label className="chk">
            <input type="checkbox" checked={rules.exclude_national_chains} onChange={(e) => setRules({ ...rules, exclude_national_chains: e.target.checked })} /> Deixar de fora redes nacionais com preço tabelado
          </label>
          <label className="chk">
            <input type="checkbox" checked={rules.same_neighborhood_only} onChange={(e) => setRules({ ...rules, same_neighborhood_only: e.target.checked })} /> Considerar só lojas que entregam no mesmo bairro
          </label>
        </div>
      </details>

      <div className="small muted" style={{ borderTop: "1px solid var(--color-border-subtle)", paddingTop: 12 }}>
        {cost} O primeiro resultado costuma ficar pronto em 30 minutos a 2 horas.
      </div>
      {error ? (
        <div className="banner badb" role="alert">
          <span>{error}</span>
        </div>
      ) : null}
      <div className="row-flex">
        <button type="submit" className="btn primary" disabled={blocked || pending}>
          Começar a acompanhar
        </button>
        <Link className="btn" href="/app/raio-x">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
