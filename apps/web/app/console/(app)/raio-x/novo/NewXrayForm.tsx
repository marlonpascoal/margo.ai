"use client";
// C02 form, as drawn. The link is checked as you type (D29: an iFood store link ends with its uuid); a
// valid link shows the store when the public catalog already knows it. No request goes to iFood here.
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { primaryButton, secondaryButton } from "@/components/xray";
import { storeIdFromUrl } from "@/lib/xray/ifood-url";
import { CATEGORY_OPTIONS, RADIUS_OPTIONS, XRAY_MESSAGES } from "@/lib/xray/labels";
import { createXrayAction, lookupStoreAction, type CreateState, type StoreLookup } from "../actions";

const field = "box-border min-h-11 rounded-md border border-border-strong bg-surface px-3 text-base text-ink";
const label = "text-md font-semibold";
const check = "flex items-center gap-2.5 text-md";

export default function NewXrayForm({ initialUrl }: { initialUrl: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [store, setStore] = useState<StoreLookup | null>(null);
  const [state, action, pending] = useActionState<CreateState, FormData>(createXrayAction, { message: null });
  const valid = storeIdFromUrl(url) !== null;
  const invalid = url.trim() !== "" && !valid;

  useEffect(() => {
    let live = true;
    if (valid) lookupStoreAction(url).then((s) => live && setStore(s));
    return () => {
      live = false;
    };
  }, [url, valid]);

  return (
    <form action={action} className="box-border flex max-w-[720px] flex-col gap-5 rounded-xl border border-border bg-surface p-4 md:p-6" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="url" className={label}>
          Link da loja no iFood
        </label>
        <input
          id="url"
          name="url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-invalid={invalid}
          aria-describedby="url-help"
          className={`${field} min-w-0 font-mono text-sm`}
          placeholder="ifood.com.br/delivery/..."
          autoComplete="off"
        />
        <div id="url-help" className="text-sm" aria-live="polite">
          {invalid && (
            <span role="alert" className="text-danger">
              {XRAY_MESSAGES.invalidUrl}
            </span>
          )}
          {valid && store?.state === "found" && (
            <span className="text-ok">Loja encontrada: {[store.name, store.area, store.category].filter(Boolean).join(" · ")}</span>
          )}
          {valid && store?.state === "unknown" && <span className="text-ink-muted">{XRAY_MESSAGES.unknownStore}</span>}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="raio" className={label}>
            Raio da vizinhança
          </label>
          <select id="raio" name="raio" className={field} defaultValue="3">
            {RADIUS_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cat" className={label}>
            Categorias que contam como concorrente
          </label>
          <select id="cat" name="categorias" className={field} defaultValue="lanches">
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset className="m-0 flex flex-col gap-2.5 rounded-md border border-border-subtle px-4 py-3">
        <legend className="px-1 text-sm font-semibold">Regras do conjunto competitivo</legend>
        <label className={check}>
          <input type="checkbox" name="fechadas" defaultChecked /> Excluir lojas fechadas há mais de 30 dias
        </label>
        <label className={check}>
          <input type="checkbox" name="redes" defaultChecked /> Excluir redes nacionais com preço tabelado
        </label>
        <label className={check}>
          <input type="checkbox" name="bairro" /> Considerar só lojas que entregam no mesmo bairro
        </label>
      </fieldset>
      {state.message && (
        <div role="alert" className="text-sm text-danger">
          {state.message}
        </div>
      )}
      <div className="flex flex-wrap gap-2.5">
        <button type="submit" className={primaryButton} disabled={pending || !valid}>
          Buscar vizinhança
        </button>
        <Link href="/console" className={secondaryButton}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
