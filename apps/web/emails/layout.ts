// The e-mail layout of E01 and E02 (design/E01-EmailFechamento.dc.html, E02-EmailPrazo.dc.html), shared by
// every notice of 04 §9. Each e-mail goes as HTML plus a plain-text version. E-mail clients do not read CSS
// variables, so colors and sizes are inlined from the generated tokens (tokens.ts). No em dashes (D22).
import type { NoticeMessage, Recipient } from "@/lib/notify/plan";
import { ROLE_LABEL } from "@/lib/notify/templates";
import { TOKENS, type TokenName } from "./tokens";

/** Sender of every notice (D36; domain still to be confirmed). */
export const SENDER = { name: "MargoAI", email: "avisos@margoai.com" } as const;
export const NOTIFICATIONS_PATH = "/app/notificacoes";
/** D46: every e-mail rendered from a synthetic account carries this label. */
export const SYNTHETIC_LABEL = "SINTÉTICO · dados fictícios";

/** Where links in e-mails point: MARGO_APP_URL on the platform; locally the dev server. */
export function appUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.MARGO_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** A piece of text where `strong` parts are bold (and mono, for money, as drawn). */
export type Rich = string | { strong: string; mono?: boolean };

export type Block =
  | { kind: "p"; text: Rich[]; muted?: boolean }
  | { kind: "rows"; rows: { label: string; value: string; tone?: "ok" | "danger" }[] }
  | { kind: "callout"; text: Rich[]; tone?: "danger" | "ok" | "warn" }
  | { kind: "steps"; items: Rich[][] }
  | { kind: "button"; label: string; path: string };

export interface EmailContent {
  subject: string;
  title: string;
  blocks: Block[];
  /** Short WhatsApp text for the same notice (sent by hand until the platform, D36). */
  whatsapp: string;
}

export interface EmailOptions {
  synthetic: boolean;
  baseUrl?: string;
  /** "<bucket>/<path>" of a file to attach (E01: the P06 PDF). */
  attachmentPath?: string | null;
}

const t = (name: TokenName) => TOKENS[name];
const FONT = "'Public Sans', Arial, sans-serif";
const MONO = "'IBM Plex Mono', 'Courier New', monospace";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function richHtml(parts: Rich[]): string {
  return parts
    .map((p) => (typeof p === "string" ? esc(p) : `<b${p.mono ? ` style="font-family: ${MONO}"` : ""}>${esc(p.strong)}</b>`))
    .join("");
}

const richText = (parts: Rich[]) => parts.map((p) => (typeof p === "string" ? p : p.strong)).join("");

const TONE_BG = { danger: "color-danger-bg", ok: "color-ok-bg", warn: "color-warn-bg" } as const;
const TONE_FG = { danger: "color-danger", ok: "color-ok" } as const;

function blockHtml(b: Block, base: string): string {
  switch (b.kind) {
    case "p":
      return `<p style="margin: 0; font-size: ${b.muted ? t("text-md") : "16px"}; line-height: 1.55; color: ${t(b.muted ? "color-ink-2" : "color-ink")}">${richHtml(b.text)}</p>`;
    case "rows": {
      const rows = b.rows
        .map((r, i) => {
          const line = i < b.rows.length - 1 ? `border-bottom: 1px solid ${t("color-border-subtle")}; ` : "";
          const color = r.tone ? `; color: ${t(TONE_FG[r.tone])}` : "";
          return `<tr><td style="padding: 10px 0; ${line}">${esc(r.label)}</td><td style="padding: 10px 0; ${line}text-align: right; font-family: ${MONO}${color}">${esc(r.value)}</td></tr>`;
        })
        .join("");
      return `<table role="presentation" style="width: 100%; border-collapse: collapse; font-size: ${t("text-base")}"><tbody>${rows}</tbody></table>`;
    }
    case "callout":
      return `<div style="padding: 16px; background: ${t(TONE_BG[b.tone ?? "danger"])}; border-radius: ${t("radius-lg")}; font-size: ${t("text-base")}; line-height: 1.55">${richHtml(b.text)}</div>`;
    case "steps":
      return `<ol style="margin: 0; padding-left: 20px; font-size: ${t("text-base")}; line-height: 1.6">${b.items.map((i) => `<li style="margin-bottom: 6px">${richHtml(i)}</li>`).join("")}</ol>`;
    case "button":
      return `<a href="${esc(base + b.path)}" style="display: block; text-align: center; padding: 14px 0; background: ${t("color-ink")}; color: ${t("color-ink-inverse")}; border-radius: ${t("radius-lg")}; font-weight: 700; text-decoration: none">${esc(b.label)}</a>`;
  }
}

function blockText(b: Block, base: string): string {
  switch (b.kind) {
    case "p":
    case "callout":
      return richText(b.text);
    case "rows":
      return b.rows.map((r) => `${r.label}: ${r.value}`).join("\n");
    case "steps":
      return b.items.map((i, n) => `${n + 1}. ${richText(i)}`).join("\n");
    case "button":
      return `${b.label}: ${base}${b.path}`;
  }
}

/** E01, E02 footer: why the person receives it (the link and the synthetic label follow it). */
export function footerText(to: Recipient): string {
  return `Você recebe este e-mail porque é ${ROLE_LABEL[to.role]} no ${to.accountName}.`;
}

/** One person's e-mail: subject, HTML and text with the drawn footer, plus the WhatsApp text. */
export function renderEmail(c: EmailContent, to: Recipient, o: EmailOptions): NoticeMessage {
  const base = o.baseUrl ?? appUrl();
  const why = footerText(to);
  const label = o.synthetic ? ` · ${SYNTHETIC_LABEL}` : "";
  const html = [
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(c.subject)}</title></head>`,
    `<body style="margin: 0; background: ${t("color-sunken")}; color: ${t("color-ink")}; font-family: ${FONT}">`,
    `<div style="max-width: 640px; margin: 0 auto; padding: 24px; box-sizing: border-box">`,
    `<div style="background: ${t("color-surface")}; border-radius: ${t("radius-xl")}; padding: 32px">`,
    `<div style="font-size: ${t("text-lg")}; font-weight: 700; margin-bottom: 18px">MargoAI</div>`,
    `<h1 style="margin: 0 0 18px; font-size: 26px; line-height: 1.25">${esc(c.title)}</h1>`,
    ...c.blocks.map((b) => `<div style="margin-bottom: 18px">${blockHtml(b, base)}</div>`),
    `</div>`,
    `<div style="font-size: ${t("text-xs")}; color: ${t("color-ink-muted")}; line-height: 1.6; padding: 12px 4px 0">${esc(why)} <a href="${esc(base + NOTIFICATIONS_PATH)}" style="color: ${t("color-ink")}">Mudar notificações</a>${esc(label)}</div>`,
    `</div></body></html>`,
  ].join("");
  const text = [
    c.title,
    ...c.blocks.map((b) => blockText(b, base)),
    "",
    why,
    `Mudar notificações: ${base}${NOTIFICATIONS_PATH}`,
    ...(o.synthetic ? [SYNTHETIC_LABEL] : []),
  ].join("\n\n");
  const whatsapp = o.synthetic ? `${c.whatsapp} (${SYNTHETIC_LABEL})` : c.whatsapp;
  return { subject: c.subject, body: text, html, whatsapp, attachmentPath: o.attachmentPath ?? null };
}
