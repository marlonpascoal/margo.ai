"use client";
// A select whose options are links (C07 filters, C08 month): choosing one navigates, so the page stays a
// server component and the URL keeps the state.
import { useRouter } from "next/navigation";

export default function NavSelect({ label, value, options, className = "" }: { label: string; value: string; options: { value: string; label: string; href: string }[]; className?: string }) {
  const router = useRouter();
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => {
        const o = options.find((x) => x.value === e.target.value);
        if (o) router.push(o.href);
      }}
      className={`min-h-9 rounded-sm border border-border-strong bg-surface px-2 text-sm text-ink ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
