"use client";
// P09 (phone: pick a plan, then one button) and W05 (computer: one button per plan, invoices) on the same
// route (D32). Copy and layout as drawn; states the drawings do not show come from lib/billing/view.ts.
import Link from "next/link";
import { useActionState, useState } from "react";
import type { PlanCard, PlanView } from "@/lib/billing/view";
import { checkoutAction, redeAction, type PlanActionState } from "./actions";

const initial: PlanActionState = { message: null };

function Labels({ view, boxed }: { view: PlanView; boxed: boolean }) {
  const text = [view.example ? "preços de exemplo" : null, view.synthetic ? "dados fictícios" : null].filter(Boolean).join(" · ");
  if (!text) return null;
  return boxed ? (
    <span className="rounded-xs border border-dashed border-ink-faint px-2 py-0.5 font-mono text-xs text-ink-muted">{text}</span>
  ) : (
    <span className="font-mono text-2xs text-ink-muted">{text}</span>
  );
}

function Notice({ text, role }: { text: string | null; role: "status" | "alert" }) {
  if (!text) return null;
  return (
    <div role={role} className={`rounded-lg border px-3.5 py-2.5 text-md ${role === "alert" ? "border-danger-border bg-danger-bg" : "border-warn-border bg-warn-bg"}`}>
      {text}
    </div>
  );
}

/** The action button of one plan; `wide` uses the W05 style, otherwise the P09 bottom button. */
function Cta({
  card,
  wide,
  checkout,
  rede,
  pending,
}: {
  card: PlanCard;
  wide: boolean;
  checkout: (f: FormData) => void;
  rede: (f: FormData) => void;
  pending: boolean;
}) {
  const label = wide ? card.ctaWide : card.ctaPhone;
  const primary = wide ? card.code === "lucro" : true;
  const cls = wide
    ? `mt-auto inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-md border border-ink font-semibold no-underline ${primary ? "bg-ink text-ink-inverse hover:text-ink-inverse" : "bg-surface text-ink"} disabled:cursor-default disabled:opacity-60`
    : "flex min-h-12 w-full cursor-pointer items-center justify-center rounded-lg border-0 bg-ink font-bold text-ink-inverse no-underline hover:text-ink-inverse disabled:cursor-default disabled:opacity-60";
  switch (card.action) {
    case "none":
      return null;
    case "stay_free":
      return (
        <Link href="/app" className={cls}>
          {label}
        </Link>
      );
    case "current":
      return (
        <button type="button" disabled className={cls}>
          {label}
        </button>
      );
    case "checkout":
    case "rede":
      return (
        <form action={card.action === "checkout" ? checkout : rede} className={wide ? "mt-auto" : ""}>
          <button type="submit" disabled={pending} className={cls}>
            {label}
          </button>
        </form>
      );
  }
}

export default function PlanScreen({ view }: { view: PlanView }) {
  const [pick, setPick] = useState(view.selected);
  const [checkoutState, checkout, checkoutPending] = useActionState(checkoutAction, initial);
  const [redeState, rede, redePending] = useActionState(redeAction, initial);
  const pending = checkoutPending || redePending;
  const chosen = view.cards.find((c) => c.code === pick) ?? view.cards[0];
  const ctas = { checkout, rede, pending };
  const notices = (
    <>
      <Notice text={view.banner} role="status" />
      <Notice text={checkoutState.message} role="alert" />
      <Notice text={redeState.message} role="status" />
    </>
  );

  return (
    <div>
      {/* P09, phone */}
      <main className="box-border flex min-h-[844px] flex-col gap-3 px-4 py-5 md:hidden">
        <div className="flex items-center justify-between">
          <Link href="/app" className="text-md">
            Minha conta
          </Link>
          <Labels view={view} boxed={false} />
        </div>
        <h1 className="m-0 text-2xl leading-tight">{view.phoneTitle}</h1>
        <p className="m-0 text-md leading-normal text-ink-2">{view.phoneLead}</p>
        {notices}
        {view.cards.map((c) => (
          <button
            key={c.code}
            type="button"
            onClick={() => setPick(c.code)}
            aria-pressed={c.code === pick}
            className={`flex cursor-pointer flex-col gap-1.5 rounded-xl bg-surface p-3.5 text-left font-sans text-ink ${c.code === pick ? "border-2 border-ink" : "border border-border"}`}
          >
            <span className="flex w-full items-baseline justify-between">
              <b className="text-[17px]">{c.name}</b>
              <span className="font-mono text-base font-semibold">{c.pricePhone}</span>
            </span>
            <span className="text-sm leading-[1.45] text-ink-2">{c.description}</span>
          </button>
        ))}
        <div className="mt-auto flex flex-col gap-2">
          <div className="flex justify-between text-md">
            <span>
              Escolhido: <b>{chosen.name}</b>
            </span>
            <span className="font-mono">{chosen.total}</span>
          </div>
          <Cta card={chosen} wide={false} {...ctas} />
          <div className="text-center text-xs text-ink-muted">Só cartão de crédito. Cancele quando quiser.</div>
        </div>
      </main>

      {/* W05, computer */}
      <main className="mx-auto box-border hidden max-w-[1180px] flex-col gap-5 px-8 py-7 md:flex">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="m-0 text-4xl">Plano e cobrança</h1>
            <span className="text-base text-ink-muted">{view.wideLead}</span>
          </div>
          <Labels view={view} boxed />
        </div>
        {notices}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
          {view.cards.map((c) => (
            <section
              key={c.code}
              aria-label={`Plano ${c.name}`}
              className={`flex flex-col gap-2.5 rounded-xl bg-surface p-5 ${c.code === "lucro" ? "border-2 border-ink" : "border border-border"}`}
            >
              <b className="text-xl">{c.name}</b>
              <span className="font-mono text-lg">{c.priceWide}</span>
              <span className="text-md leading-normal text-ink-2">{c.description}</span>
              <span className="text-sm text-ink-muted">{c.calc}</span>
              <Cta card={c} wide {...ctas} />
            </section>
          ))}
        </div>
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[600px] border-collapse text-md">
            <caption className="border-b border-border px-3.5 py-3 text-left font-bold">Faturas</caption>
            <thead>
              <tr className="text-left text-xs tracking-[0.04em] text-ink-muted uppercase">
                <th className="border-b border-border px-3.5 py-2.5">Mês</th>
                <th className="border-b border-border px-3.5 py-2.5">Cozinhas</th>
                <th className="border-b border-border px-3.5 py-2.5 text-right">Valor</th>
                <th className="border-b border-border px-3.5 py-2.5">Situação</th>
                <th className="border-b border-border px-3.5 py-2.5">Nota fiscal</th>
              </tr>
            </thead>
            <tbody>
              {view.invoices.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3.5 py-4 text-md text-ink-muted">
                    Nenhuma fatura ainda. A primeira sai quando o teste acabar e você escolher um plano.
                  </td>
                </tr>
              ) : (
                view.invoices.map((i) => (
                  <tr key={i.id}>
                    <td className="border-b border-border-subtle px-3.5 py-2.5">{i.month}</td>
                    <td className="border-b border-border-subtle px-3.5 py-2.5 font-mono">{i.units}</td>
                    <td className="border-b border-border-subtle px-3.5 py-2.5 text-right font-mono">{i.value}</td>
                    <td className="border-b border-border-subtle px-3.5 py-2.5">{i.status}</td>
                    <td className="border-b border-border-subtle px-3.5 py-2.5"></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
