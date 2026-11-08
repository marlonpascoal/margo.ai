// P20 (phone) / W11 (computer): "Acompanhar uma loja" (draft §2.4). Dono only (manage_monitors; others 404). The
// options mirror monitor_limits; monitor_create checks the limits again on the server (M1-01, M1-02, D29).
import { loadDeps } from "@/lib/monitor/deps";
import { loadMonitorList } from "@/lib/monitor/load";
import { periodOptions } from "@/lib/monitor/rules";
import { requirePortal } from "@/lib/portal/session";
import NovoForm from "../_components/NovoForm";
import { Crumb, Fict, Head } from "../_components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Acompanhar uma loja · MargoAI" };

export default async function NewMonitorPage() {
  const m = await requirePortal({ action: "manage_monitors", flags: ["m1.portal"] });
  const [{ monitors, limits }, { data: stores }, { data: kitchens }] = await Promise.all([
    loadMonitorList(loadDeps(m.db), m.account.id),
    m.db.from("channel_store").select("id, name, kitchen_id").eq("account_id", m.account.id).eq("channel", "ifood").order("name"),
    m.db.from("kitchen").select("id, name").eq("account_id", m.account.id).order("name"),
  ]);
  const followed = new Set(monitors.map((x) => x.store_name));
  const ownFull = limits.own_max !== null && limits.own_active >= limits.own_max;
  const compFull = limits.competitor_active >= limits.competitor_max || (limits.count_month_starts && limits.competitor_started_month >= limits.competitor_max);
  return (
    <main className="rx-main">
      <Crumb>Acompanhar uma loja</Crumb>
      <Head title="Acompanhar uma loja" lead="Só usamos o que está público no iFood. Nada é pedido à loja nem muda no seu cardápio.">
        <Fict synthetic={m.account.isSynthetic} />
      </Head>
      <NovoForm
        stores={(stores ?? []).map((s) => ({ id: s.id, name: s.name, followed: followed.has(s.name) }))}
        kitchens={(kitchens ?? []).map((k) => ({ id: k.id, name: k.name.replace(/^Cozinha\s+/i, "") }))}
        periods={periodOptions(limits.min_every_days).map((p) => ({ days: p.days, label: p.label }))}
        competitorAllowed={limits.competitor_allowed}
        competitorFull={compFull}
        competitorMax={limits.competitor_max}
        competitorLeftMonth={Math.max(limits.competitor_max - limits.competitor_started_month, 0)}
        ownFull={ownFull}
        ownMax={limits.own_max}
        plan={limits.plan}
      />
    </main>
  );
}
