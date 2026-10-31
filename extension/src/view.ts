// P04 labels as drawn (design/P04-Extensao.dc.html). Pure, so the tests check them without a browser.
import { PORTAL_ORIGIN } from "./config";

const MON = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "último envio: 28/out 21:14 · dados fictícios" (São Paulo time). Not drawn: "ainda não enviou" before any. */
export function lastUploadLabel(iso: string | null, synthetic: boolean): string {
  let text = "último envio: ainda não enviou";
  if (iso) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
    const get = (t: string) => parts.find((p) => p.type === t)!.value;
    text = `último envio: ${Number(get("day"))}/${MON[Number(get("month")) - 1]} ${get("hour")}:${get("minute")}`;
  }
  return synthetic ? `${text} · dados fictícios` : text;
}

/** The popup works only on the Partner Portal tab the owner opened (05 P04 rules). */
export function onPartnerPortal(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).origin === PORTAL_ORIGIN;
  } catch {
    return false;
  }
}

/** The drawn note, changed in one sentence: the extension does not click Export, the owner picks the file. */
export const NOTE = "A extensão só usa a página que você abriu, no seu navegador. Você escolhe o arquivo que exportou e ela manda para a MargoAI. Não vê nem guarda sua senha.";
