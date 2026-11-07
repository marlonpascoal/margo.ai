// P15: a person in more than one group chooses which to open after login. Not drawn; P15 layout.
import { redirect } from "next/navigation";
import { ROLE_LABEL } from "@/lib/portal/menu";
import { membershipsOf, portalPersonId } from "@/lib/portal/session";
import { sessionReader } from "@/lib/supabase/server";
import { chooseAccount } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Escolher grupo · MargoAI" };

export default async function EscolherContaPage() {
  const personId = await portalPersonId();
  if (!personId) redirect("/entrar");
  const memberships = await membershipsOf(await sessionReader(null), personId);
  return (
    <div className="flex min-h-screen justify-center bg-surface text-ink md:bg-bg md:py-10">
      <div className="box-border flex w-full max-w-[440px] flex-col gap-4 px-5 py-7 md:rounded-2xl md:border md:border-border md:bg-surface md:p-8">
        <div className="text-base font-extrabold">MargoAI</div>
        <h1 className="m-0 text-[26px]">Qual grupo abrir?</h1>
        <form action={chooseAccount} className="flex flex-col gap-2.5">
          {memberships.map((m) => (
            <button
              key={m.accountId}
              type="submit"
              name="account"
              value={m.accountId}
              className="flex min-h-14 cursor-pointer flex-col items-start justify-center rounded-xl border border-border bg-surface px-3.5 py-2.5 text-left text-ink"
            >
              <b className="text-base">{m.accountName}</b>
              <span className="text-sm text-ink-muted">{ROLE_LABEL[m.role]}</span>
            </button>
          ))}
        </form>
      </div>
    </div>
  );
}
