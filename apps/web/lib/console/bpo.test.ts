// C18 table and brand checks, as drawn (design/C18-BPO.dc.html).
import { describe, expect, it } from "vitest";
import { isHexColor, logoKind, partnerRow, type PartnerRecord } from "./bpo";

const p = (over: Partial<PartnerRecord> = {}): PartnerRecord => ({
  id: "b1",
  name: "BPO 01",
  folder_url: "https://drive.exemplo.com.br/bpo-01",
  logo_path: null,
  primary_color: "#1351B4",
  show_powered_by: false,
  price_per_store_cents: null,
  pipeline_note: null,
  updated_at: "2026-10-30T12:00:00Z",
  ...over,
});

describe("C18 partners table", () => {
  it("C18_rows_as_drawn", () => {
    expect(partnerRow(p(), { clients: 2, stores: 7, lastFolderFile: "2026-10-26T21:40:00Z" })).toEqual({
      id: "b1",
      name: "BPO 01",
      clients: "2 grupos · 7 lojas",
      folder: { text: "arquivos de out chegaram", ok: true },
      price: "[a definir]",
    });
    expect(partnerRow(p({ name: "BPO 02", folder_url: null, pipeline_note: "conversa marcada" }), { clients: 0, stores: 0, lastFolderFile: null })).toMatchObject({
      clients: "conversa marcada",
      folder: { text: "não criada", ok: false },
    });
    expect(partnerRow(p({ price_per_store_cents: 30_000 }), { clients: 1, stores: 1, lastFolderFile: null })).toMatchObject({
      clients: "1 grupo · 1 loja",
      folder: { text: "criada, sem arquivos", ok: false },
      price: "R$ 300,00",
    });
  });

  it("C18_brand_color_and_logo_are_checked_server_side", () => {
    expect(isHexColor("#1351B4")).toBe(true);
    expect(isHexColor("1351B4")).toBe(false);
    expect(isHexColor("#1351B4;background:url(x)")).toBe(false);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    expect(logoKind("logo.png", png)).toBe("png");
    expect(logoKind("logo.svg", new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe("svg");
    expect(logoKind("logo.png", new TextEncoder().encode("<svg></svg>"))).toBeNull();
    expect(logoKind("logo.jpg", png)).toBeNull();
    expect(logoKind("logo.png", new Uint8Array(600 * 1024).fill(0x89))).toBeNull();
  });
});
