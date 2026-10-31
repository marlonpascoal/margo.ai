"use client";
// A checkbox or select that submits its form when it changes (W02 "Na análise", W04 "Perfil de ...").
// Without JavaScript the form's own submit button does the same.
import type { ComponentProps } from "react";

export function AutoSubmitCheckbox(props: Omit<ComponentProps<"input">, "type" | "onChange">) {
  return <input {...props} type="checkbox" onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}

export function AutoSubmitSelect(props: Omit<ComponentProps<"select">, "onChange">) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}

/** Copies a text to the clipboard (W03 "Copiar texto", P12 "Copiar texto pronto"). */
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  return (
    <button type="button" className={className} onClick={() => void navigator.clipboard?.writeText(text)}>
      {label}
    </button>
  );
}
