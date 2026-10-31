// P05 (05 §C, design/P05-WhatsNota.dc.html): the WhatsApp text C10 opens with "Pedir nota pelo WhatsApp",
// and the reply after a QR is read. Copy verbatim from the drawing; lists only the missing top-20 insumos.
import { joinPt } from "@/lib/format";

/** "Oi! Faltam 4 itens para fechar o custo do cardápio: queijo cheddar, bacon, pão brioche e embalagem. ..." */
export function invoiceRequestText(missing: string[]): string {
  const n = missing.length;
  const items = n === 1 ? "Falta 1 item" : `Faltam ${n} itens`;
  return `Oi! ${items} para fechar o custo do cardápio: ${joinPt(missing)}. Quando chegar uma nota com qualquer um deles, manda uma foto aqui. Só isso.`;
}

/** "Li a nota pelo QR code: Bacon em cubos, R$ 46,00/kg. Obrigado! Agora faltam 3." */
export function qrReadReplyText(ingredient: string, price: string, stillMissing: number): string {
  const tail = stillMissing === 0 ? "Agora não falta nenhum." : stillMissing === 1 ? "Agora falta 1." : `Agora faltam ${stillMissing}.`;
  return `Li a nota pelo QR code: ${ingredient}, ${price}. Obrigado! ${tail}`;
}

/** The owner reads the short name ("queijo cheddar"), lower case; without one, the catalog name. */
export const shortName = (i: { name: string; short_name: string | null }) => i.short_name ?? i.name.toLowerCase();

/** Click-to-chat with the text; the founder picks the contact (manual WhatsApp, D36). */
export const whatsappTextLink = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
