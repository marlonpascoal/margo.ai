// TEST ONLY (A05, e2e/flags.spec.ts). Compiled only when MARGO_E2E_ROUTES=1 (next.config.ts), so no
// preview or production build contains it; it also answers 404 outside the local stack.
// No built screen has a flag yet in Wave 0, so this page stands in for "a screen behind a flag":
// /teste-e2e/flag?chave=<flag key>&conta=<account code> renders while the flag is on for that account
// and answers 404 through requireFlag when it is off.
import { notFound } from "next/navigation";
import { requireFlag } from "@/lib/flags";
import { isFlagKey } from "@/lib/flags/keys";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function FlagProbePage({ searchParams }: { searchParams: Promise<{ chave?: string; conta?: string }> }) {
  if (process.env.MARGO_ENV !== "local" || process.env.MARGO_E2E_ROUTES !== "1") notFound();
  const { chave, conta } = await searchParams;
  if (!isFlagKey(chave)) notFound();
  let accountId: string | null = null;
  if (conta) {
    const { data } = await adminClient().from("account").select("id").eq("code", conta).maybeSingle();
    if (!data) notFound();
    accountId = data.id;
  }
  await requireFlag(chave, accountId);
  return (
    <main className="p-6 font-mono text-sm" data-flag-probe={chave}>
      {chave} ligada{conta ? ` para ${conta}` : ""}
    </main>
  );
}
