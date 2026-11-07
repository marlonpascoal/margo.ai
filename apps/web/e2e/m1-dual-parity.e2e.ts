// B01, M1-05 and M1-07 on C05: dual parity with synthetic rows built here, since the G-SYN seed has no promotion
// (m1.e2e.ts proves the seeded rows show exactly what is drawn). The rows are what the worker writes.
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { FOUNDER_EMAIL, adminDb, loginToConsole } from "./helpers";

test("B01_M1_05_M1_07_C05_shows_the_full_parity_and_the_note_only_when_they_apply", async ({ page }) => {
  const db = adminDb();
  const { data: me } = await db.from("person").select("id").eq("email", FOUNDER_EMAIL).single();
  const { data: store, error: storeError } = await db
    .from("public_store")
    .insert({ channel: "ifood", external_id: randomUUID(), name: "Alvo SINTÉTICO paridade dupla" })
    .select("id")
    .single();
  if (storeError) throw storeError;
  const { data: xray, error: xrayError } = await db
    .from("xray")
    .insert({ target_store_id: store!.id, radius_km: 3, status: "ready", collected_at: "2026-11-01T12:00:00Z", created_by: me!.id })
    .select("id")
    .single();
  if (xrayError) throw xrayError;

  try {
    const rows = [
      // Own price, then current parity and gap, then full parity and gap, then the M1-07 note.
      { name: "Alfa", own: 1000, parity: 1300, gap: -0.2308, reading: "pode_subir", full: 1500, gapFull: -0.3333, room: false },
      { name: "Bravo", own: 1000, parity: 1050, gap: -0.0476, reading: "na_media", full: 1300, gapFull: -0.2308, room: true },
      { name: "Delta", own: 1000, parity: 1000, gap: 0, reading: "na_media", full: 1000, gapFull: 0, room: false },
      { name: "Antigo", own: 1000, parity: 1200, gap: -0.1667, reading: "pode_subir", full: null, gapFull: null, room: false },
    ] as const;
    for (const r of rows) {
      const { data: item, error } = await db
        .from("public_menu_item")
        .insert({ public_store_id: store!.id, external_item_id: r.name, name: r.name, price_cents: r.own, unit: "un", collected_at: "2026-11-01T12:00:00Z" })
        .select("id")
        .single();
      if (error) throw error;
      const { error: itemError } = await db.from("xray_item").insert({
        xray_id: xray!.id,
        public_menu_item_id: item!.id,
        norm_unit: "un",
        norm_price_cents: r.own,
        parity_cents: r.parity,
        gap_pct: r.gap,
        loss_cents: r.parity - r.own,
        reading: r.reading,
        pair_status: "auto",
        parity_full_cents: r.full,
        gap_full_pct: r.gapFull,
        full_price_room: r.room,
      });
      if (itemError) throw itemError;
    }

    await loginToConsole(page, FOUNDER_EMAIL);
    await page.goto(`/console/raio-x/${xray!.id}`);
    const row = (name: string) => page.locator(`tr[data-item="${name}"]`);
    await expect(row("Alfa")).toHaveText("AlfaR$ 10,00R$ 13,00sem promoção: R$ 15,00, −33%−23%pode subir hoje");
    await expect(row("Bravo")).toHaveText("BravoR$ 10,00R$ 10,50sem promoção: R$ 13,00, −23%−5%na faixapode subir quando os vizinhos não estão em promoção");
    await expect(row("Delta")).toHaveText("DeltaR$ 10,00R$ 10,000%na faixa");
    await expect(row("Antigo")).toHaveText("AntigoR$ 10,00R$ 12,00−17%pode subir hoje");
  } finally {
    await db.from("xray").delete().eq("id", xray!.id);
    await db.from("public_menu_item").delete().eq("public_store_id", store!.id);
    await db.from("public_store").delete().eq("id", store!.id);
  }
});
