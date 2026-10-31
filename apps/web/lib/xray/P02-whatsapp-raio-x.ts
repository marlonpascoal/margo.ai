// P02 (05 §C): the WhatsApp text that goes with the X-ray, edited in C06. Copy verbatim from the C06
// drawing (design/C06-Entrega.dc.html), with the drawn numbers replaced by the X-ray's and
// "[link de autorização]" by the sign-up link that carries the X-ray reference (D29, P07).

export interface XrayMessage {
  storeName: string;
  storesCompared: number;
  radiusKm: number;
  /** Items in "três preços que você pode subir hoje" (M1-09, at most 3). */
  itemsToRaise: number;
  link: string;
}

export function xrayMessage(m: XrayMessage): string {
  const items = m.itemsToRaise === 1 ? "1 item" : `${m.itemsToRaise} itens`;
  return (
    `Oi! Fizemos um raio-X dos preços da ${m.storeName} comparando com ${m.storesCompared} lojas num raio de ${m.radiusKm} km. ` +
    `Tem ${items} que dá para subir hoje sem risco. O PDF está aqui. ` +
    `Para saber o que dá lucro de verdade, dá para conectar o iFood em 2 minutos: ${m.link}`
  );
}

/** C06: the sign-up link with the X-ray reference (05 C06 "Done when"). */
export const signupLink = (origin: string, xrayId: string) => `${origin.replace(/\/$/, "")}/criar-conta?ref=${encodeURIComponent(xrayId)}`;

/** Click-to-chat with the text; the founder picks the contact (manual send, D36). */
export const whatsappLink = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
