// C02 Novo raio-X (design/C02-NovoRaioX.dc.html, 05 §A). Staff, flag m1.raio_x. A lead from the landing
// page arrives with ?link= (05 §0). ?conta=<code> makes the X-ray one of that account's (competitor X-rays
// are limited per plan, migration 20261212000001).
import { ConsoleMain } from "@/components/console";
import { XrayTitle } from "@/components/xray";
import { requireFlag } from "@/lib/flags";
import { requireConsole } from "@/lib/console/staff";
import { accountByCode } from "@/lib/xray/deps";
import NewXrayForm from "./NewXrayForm";

export const metadata = { title: "Novo raio-X · MargoAI" };

export default async function NewXrayPage({ searchParams }: { searchParams: Promise<{ link?: string; conta?: string }> }) {
  await requireConsole("clients");
  await requireFlag("m1.raio_x", null);
  const { link, conta } = await searchParams;
  const account = conta ? await accountByCode(conta) : null;
  return (
    <ConsoleMain>
      <XrayTitle code="C02" step={1} title="Novo raio-X de preço" lead="Só dado público do cardápio. Nada é pedido ao restaurante neste passo." />
      <NewXrayForm initialUrl={link ?? ""} account={account ? { code: account.code, name: account.name } : null} />
    </ConsoleMain>
  );
}
