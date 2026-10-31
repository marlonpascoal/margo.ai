"use client";
// C20 "Ambiente": sandbox and production keep separate values (04 §6). The choice lives in ?amb=.
import { usePathname, useRouter } from "next/navigation";
import type { FlagEnv } from "@/lib/flags/keys";

export default function EnvSwitch({ env, options }: { env: FlagEnv; options: { value: FlagEnv; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="amb" className="text-sm text-ink-muted">
        Ambiente
      </label>
      <select
        id="amb"
        value={env}
        onChange={(e) => router.push(`${pathname}?amb=${e.target.value}`)}
        className="min-h-10 rounded-md border border-border-strong bg-surface px-2.5 text-ink"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
