"use client";
// W07: while the iFood step is "aguardando", re-read the page every minute so stores found by the merchant
// list show up within 5 minutes (05 P03/W07 "Done when").
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AutoRefresh({ everyMs = 60_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}
