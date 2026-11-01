// P04 popup (design/P04-Extensao.dc.html, 05 P04, 06 §9, D01a). On the Partner Portal tab, "Exportar e
// enviar" asks the content script of that tab to click the portal's Export button and hand over the file,
// then sends it. When the button is not found (or no content script answers), the owner picks the file they
// exported, as before. No navigation, no other tab, nothing else read from the page.
import { chromeTokens, createClient, MESSAGES, type Client, type Status } from "./api";
import { API_BASE } from "./config";
import { decodeFile, EXPORT_NOW, type ExportReply } from "./portal";
import { lastUploadLabel, NOTE, onPartnerPortal } from "./view";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function el<T extends HTMLElement = HTMLElement>(tag: string, props: Record<string, unknown> = {}, ...children: (Node | string)[]): T {
  const n = Object.assign(document.createElement(tag), props) as T;
  n.append(...children);
  return n;
}

function setState(text: string | null, off = false) {
  const s = $("state");
  s.hidden = !text;
  s.textContent = text ?? "";
  s.className = off ? "pill off" : "pill";
}

function message(text: string, bad = false) {
  return el("p", { className: bad ? "msg bad" : "msg", role: bad ? "alert" : "status" }, text);
}

/** Not drawn: pairing with the short code from the portal (W07) or a founder (console). */
function renderPairing(client: Client, notice?: string) {
  setState("não conectada", true);
  $("foot").textContent = "";
  const input = el<HTMLInputElement>("input", { id: "code", className: "field", autocomplete: "off", spellcheck: false, placeholder: "K7M4-Q9TX" });
  const button = el<HTMLButtonElement>("button", { className: "primary", type: "submit" }, "Conectar");
  const form = el(
    "form",
    {},
    el("label", { htmlFor: "code", className: "label" }, "Código que o portal mostrou"),
    input,
    button,
  );
  form.style.display = "contents";
  const out = el("div");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    button.disabled = true;
    const r = await client.pair(input.value);
    button.disabled = false;
    if (r.ok) return start(client);
    out.replaceChildren(message(r.message, true));
  });
  $("main").replaceChildren(
    el("p", { className: "lead" }, "Para conectar, abra o portal da MargoAI no computador, em Conectar os apps, e digite aqui o código."),
    ...(notice ? [message(notice, true)] : []),
    form,
    out,
    el("p", { className: "note" }, NOTE),
  );
}

function renderStatus(client: Client, st: Status, portal: boolean, tabId: number | undefined) {
  setState("conectada");
  $("foot").textContent = lastUploadLabel(st.lastUpload, st.account.synthetic);
  const main = $("main");
  const nodes: Node[] = [];

  let storeId: string | null = st.stores[0]?.id ?? null;
  if (!portal) {
    // Not drawn: the popup was opened on another page.
    nodes.push(el("p", { className: "lead" }, "Abra o ", el("b", {}, "Portal do Parceiro"), " nesta aba para mandar os relatórios."));
  } else if (st.stores.length <= 1) {
    nodes.push(el("p", { className: "lead" }, "Você está no ", el("b", {}, "Portal do Parceiro"), ", loja ", el("b", {}, st.stores[0]?.name ?? st.account.name), "."));
  } else {
    const select = el<HTMLSelectElement>("select", { id: "store", className: "field" }, ...st.stores.map((s) => el("option", { value: s.id }, s.name)));
    select.addEventListener("change", () => (storeId = select.value));
    nodes.push(el("p", { className: "lead" }, "Você está no ", el("b", {}, "Portal do Parceiro"), ". Loja do arquivo:"), select);
  }

  nodes.push(el("div", { className: "label" }, "Relatórios que a MargoAI pediu"));
  const boxes = st.reports.map((r) => {
    const box = el<HTMLInputElement>("input", { type: "checkbox", checked: r.requested, value: r.key });
    box.setAttribute("aria-label", r.name);
    nodes.push(el("label", { className: "report" }, box, el("span", {}, el("b", {}, r.name), el("small", {}, r.period))));
    return box;
  });

  const file = el<HTMLInputElement>("input", { type: "file", accept: ".csv,.xlsx", className: "sr", id: "arquivo" });
  file.setAttribute("aria-label", "Arquivo exportado do Portal do Parceiro");
  const send = el<HTMLButtonElement>("button", { className: "primary", type: "button", disabled: !portal }, "Exportar e enviar");
  const out = el("div");
  let manual = false;

  async function upload(f: File) {
    send.disabled = true;
    const r = await client.upload(f, storeId, boxes.filter((b) => b.checked).map((b) => b.value));
    send.disabled = false;
    file.value = "";
    if (r.ok) {
      out.replaceChildren(message(MESSAGES.sent));
      return;
    }
    if (r.kind === "unpaired") return renderPairing(client, r.message);
    out.replaceChildren(message(r.message, true));
  }

  send.addEventListener("click", async () => {
    if (manual || tabId === undefined) return file.click();
    send.disabled = true;
    out.replaceChildren(message(MESSAGES.exporting));
    let reply: ExportReply | undefined;
    try {
      reply = await chrome.tabs.sendMessage<ExportReply>(tabId, { type: EXPORT_NOW });
    } catch {
      reply = undefined; // no content script on this tab
    }
    send.disabled = false;
    if (reply?.ok) return upload(decodeFile(reply.file));
    if (!reply || reply.reason === "no-button") {
      // Fallback: the owner picks the file they exported (the click still counts as theirs).
      out.replaceChildren(message(MESSAGES.pickFile));
      return file.click();
    }
    manual = true;
    out.replaceChildren(message(MESSAGES.noDownload, true));
  });
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    if (f) void upload(f);
  });
  nodes.push(send, file, out, el("p", { className: "note" }, NOTE));
  main.replaceChildren(...nodes);
}

async function start(client: Client) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const st = await client.status();
  if (st.ok) return renderStatus(client, st.value, onPartnerPortal(tab?.url), tab?.id);
  if (st.kind === "unpaired") return renderPairing(client);
  setState(null);
  $("main").replaceChildren(message(st.message, true));
}

void start(createClient(API_BASE, (url, init) => fetch(url, init), chromeTokens()));
