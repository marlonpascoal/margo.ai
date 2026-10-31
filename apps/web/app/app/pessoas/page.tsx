// P14 / W04 Pessoas e acessos (design/P14-Pessoas.dc.html phone, design/W04-Pessoas.dc.html computer;
// 05 §B, 04 §5, §8, D33, D35). Flag conta.pessoas. The Dono sees and changes everyone; others see only
// themselves, read-only. Changes are refused while a security_lock is active (E04).
import { AutoSubmitSelect } from "@/components/AutoSubmit";
import { CARD, DeskFictitious, DeskTitle, Notice, PHONE_PRIMARY, PhoneTop, PortalMain, SMALL_BUTTON, TD, TH } from "@/components/portal";
import { canPortal } from "@/lib/permissions";
import { peopleLockUntil, requirePortal } from "@/lib/portal/account-access";
import { loadPeople, MATRIX, type PersonRow } from "@/lib/portal/pessoas";
import { dayTimeSP, PROFILE_LABEL } from "@/lib/portal/scope";
import { adminClient } from "@/lib/supabase/admin";
import { changeKitchensAction, changeRoleAction, removePersonAction } from "./actions";
import { InviteForm, ResendInvite } from "./InviteForm";

export const metadata = { title: "Pessoas e acessos · MargoAI" };

const SELECT = "min-h-9 rounded-sm border border-border-strong bg-surface px-2 text-sm";
const DESK_INVITE = "inline-flex min-h-11 cursor-pointer items-center rounded-md bg-ink px-4.5 text-base font-semibold text-ink-inverse";

function Kitchens({ p, kitchens, edit }: { p: PersonRow; kitchens: { id: string; name: string }[]; edit: boolean }) {
  if (!edit || p.kind !== "member" || p.role === "dono") return <>{p.kitchensShort}</>;
  return (
    <details>
      <summary className="cursor-pointer">{p.kitchensShort}</summary>
      <form action={changeKitchensAction} className="mt-2 flex flex-col gap-1 text-sm">
        <input type="hidden" name="pessoa" value={p.id} />
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="todas" defaultChecked={p.allKitchens} /> Todas as cozinhas
        </label>
        {kitchens.map((k) => (
          <label key={k.id} className="flex items-center gap-1.5">
            <input type="checkbox" name="cozinha" value={k.id} defaultChecked={!p.allKitchens && p.kitchenIds.includes(k.id)} /> {k.name}
          </label>
        ))}
        <button type="submit" className={`${SMALL_BUTTON} self-start`}>
          Salvar cozinhas
        </button>
      </form>
    </details>
  );
}

function Profile({ p, edit }: { p: PersonRow; edit: boolean }) {
  const label = (
    <label className="sr-only" htmlFor={`perfil-${p.id}`}>
      Perfil de {p.name}
    </label>
  );
  if (!edit || p.kind !== "member")
    return (
      <>
        {label}
        <select id={`perfil-${p.id}`} disabled value={p.role} className={SELECT}>
          <option value={p.role}>{PROFILE_LABEL[p.role]}</option>
        </select>
      </>
    );
  return (
    <form action={changeRoleAction}>
      <input type="hidden" name="pessoa" value={p.id} />
      {label}
      <AutoSubmitSelect id={`perfil-${p.id}`} name="perfil" defaultValue={p.role} className={SELECT}>
        <option value="dono">Dono</option>
        <option value="financeiro">Financeiro</option>
        <option value="gerente">Gerente de cozinha</option>
      </AutoSubmitSelect>
    </form>
  );
}

function Action({ p, edit }: { p: PersonRow; edit: boolean }) {
  if (p.isSelf) return <span className={`${SMALL_BUTTON} cursor-default`}>Você</span>;
  if (!edit) return null;
  if (p.kind === "invite") return <ResendInvite inviteId={p.id} className={SMALL_BUTTON} />;
  return (
    <form action={removePersonAction}>
      <input type="hidden" name="pessoa" value={p.id} />
      <button type="submit" className={SMALL_BUTTON} aria-label={`Remover ${p.name}`}>
        Remover
      </button>
    </form>
  );
}

export default async function PessoasPage({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const m = await requirePortal({ flags: ["conta.pessoas"] });
  const q = await searchParams;
  const db = adminClient();
  const dono = canPortal(m.role, "people");
  const [v, lock] = await Promise.all([loadPeople(db, m.account.id, { personId: m.personId, dono }), dono ? peopleLockUntil(db, m.account.id) : null]);
  const edit = dono && !lock;

  return (
    <PortalMain>
      <PhoneTop synthetic={m.account.isSynthetic} />
      <Notice text={q.aviso} />
      {lock && <Notice text={`Mudanças em pessoas e no plano ficam bloqueadas até ${dayTimeSP(lock)}, porque um contato de login mudou.`} />}
      <h1 className="m-0 text-[22px] md:hidden">Pessoas e acessos</h1>
      <DeskTitle title="Pessoas e acessos" lead="Três perfis. Cada pessoa vê todas as cozinhas ou só as que você escolher.">
        {edit && <InviteForm label="Convidar pessoa" kitchens={v.kitchens} summaryClass={DESK_INVITE} />}
      </DeskTitle>

      {/* Phone (P14) */}
      <div className="flex flex-col gap-3 md:hidden">
        {v.rows.map((p) => (
          <div key={p.id} className={`${CARD} flex flex-col gap-1 p-3`} data-person={p.name}>
            <div className="flex justify-between gap-2">
              <b className="text-base">{p.kind === "invite" ? `${p.name} (convite pendente)` : p.name}</b>
              <span className="rounded-full bg-sunken px-2 py-0.5 text-xs">{PROFILE_LABEL[p.role]}</span>
            </div>
            <span className="text-sm text-ink-2">{p.kitchensLong}</span>
          </div>
        ))}
        <div className={`${CARD} flex flex-col gap-1.5 p-3 text-sm leading-normal`}>
          <b className="text-md">O que cada perfil vê</b>
          <span>
            <b>Dono:</b> tudo, inclusive plano, cobrança e quem tem acesso.
          </span>
          <span>
            <b>Financeiro:</b> fechamento, contestações e notas de todas as cozinhas.
          </span>
          <span>
            <b>Gerente de cozinha:</b> só a cozinha dele, sem cobrança.
          </span>
        </div>
        {edit && <InviteForm label="Convidar pelo WhatsApp" kitchens={v.kitchens} summaryClass={`${PHONE_PRIMARY} cursor-pointer`} />}
      </div>

      {/* Computer (W04) */}
      <div className={`${CARD} hidden overflow-x-auto md:block`}>
        <table className="w-full min-w-[760px] border-collapse text-md">
          <thead>
            <tr className="text-left text-xs tracking-[0.04em] text-ink-muted uppercase">
              {["Pessoa", "Perfil", "Cozinhas", "Último acesso", "Ações"].map((h) => (
                <th key={h} className={TH}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {v.rows.map((p) => (
              <tr key={p.id} data-person={p.name}>
                <td className={TD}>
                  <b>{p.name}</b>
                  <br />
                  <span className="text-xs text-ink-muted">{p.contact}</span>
                </td>
                <td className={TD}>
                  <Profile p={p} edit={edit} />
                </td>
                <td className={TD}>
                  <Kitchens p={p} kitchens={v.kitchens} edit={edit} />
                </td>
                <td className={`${TD} font-mono text-xs text-ink-muted`}>{p.lastAccess}</td>
                <td className={TD}>
                  <Action p={p} edit={edit} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={`${CARD} hidden overflow-x-auto md:block`}>
        <table className="w-full min-w-[640px] border-collapse text-md">
          <caption className="border-b border-border px-3.5 py-3 text-left font-bold">O que cada perfil pode fazer</caption>
          <thead>
            <tr className="text-xs tracking-[0.04em] text-ink-muted uppercase">
              <th className={`${TH} py-2.5 text-left`}>Ação</th>
              <th className={`${TH} py-2.5`}>Dono</th>
              <th className={`${TH} py-2.5`}>Financeiro</th>
              <th className={`${TH} py-2.5`}>Gerente de cozinha</th>
            </tr>
          </thead>
          <tbody>
            {MATRIX.map((r) => (
              <tr key={r.a} className="text-center">
                <td className={`${TD} py-2.25 text-left`}>{r.a}</td>
                <td className={`${TD} py-2.25`}>{r.d}</td>
                <td className={`${TD} py-2.25`}>{r.f}</td>
                <td className={`${TD} py-2.25`}>{r.g}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hidden text-sm text-ink-muted md:block">Toda conta tem pelo menos um Dono. Só o Dono convida, muda perfil e remove pessoas. Cada ação fica registrada com quem fez.</div>
      <DeskFictitious synthetic={m.account.isSynthetic} />
    </PortalMain>
  );
}
