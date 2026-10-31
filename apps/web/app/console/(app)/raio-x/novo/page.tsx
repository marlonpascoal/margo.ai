// C02 Novo raio-X (design/C02-NovoRaioX.dc.html, 05 §A). Staff, flag m1.raio_x. A lead from the landing
// page arrives with ?link= (05 §0).
import { ConsoleMain } from "@/components/console";
import { XrayTitle } from "@/components/xray";
import { requireFlag } from "@/lib/flags";
import { requireConsole } from "@/lib/console/staff";
import NewXrayForm from "./NewXrayForm";

export const metadata = { title: "Novo raio-X · MargoAI" };

export default async function NewXrayPage({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  await requireConsole("clients");
  await requireFlag("m1.raio_x", null);
  const { link } = await searchParams;
  return (
    <ConsoleMain>
      <XrayTitle code="C02" step={1} title="Novo raio-X de preço" lead="Só dado público do cardápio. Nada é pedido ao restaurante neste passo." />
      <NewXrayForm initialUrl={link ?? ""} />
    </ConsoleMain>
  );
}
