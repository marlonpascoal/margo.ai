// Owner portal entry flows on the local stack: E03 (portal side, 30-day session), P07 sign-up to trial,
// P18 invite, E05 preferences (page side), W09 devices, A03 (Gerente sees only Cozinha Centro).
import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { DONO_EMAIL, PANTANOS_EMAIL, adminDb, clearMail, loginToPortal, mailCode, sid, waitForResendWindow, withLoginEmail } from "./helpers";

const tag = randomBytes(4).toString("hex");
const SENT = "Mandamos um código de 6 números para o seu e-mail. Ele vale por 10 minutos.";
const reais = (cents: number) => `R$ ${String(Math.round(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

/** CNPJ check digits, computed here so no document number sits in git (scripts/secret_scan.py). */
function syntheticCnpj(): string {
  const base = `8${String(Date.now()).slice(-7)}0001`;
  const dv = (body: string) => {
    const w = body.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = [...body].reduce((a, d, i) => a + Number(d) * w[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base);
  return `${base}${d1}${dv(base + d1)}`;
}

/** Gross and payout of the September close for these stores of G-02 (C08 rows). */
async function closeSums(stores: string[]) {
  const { data } = await adminDb().from("close_line").select("gross_cents, payout_cents").eq("close_period_id", sid("G-02:close:2026-09")).in("channel_store_id", stores.map((s) => sid(`G-02:${s}`)));
  return { gross: data!.reduce((a, l) => a + l.gross_cents, 0), payout: data!.reduce((a, l) => a + l.payout_cents, 0) };
}

test.describe.configure({ mode: "serial" });

test("E03_portal_without_session_goes_to_P15", async ({ page }) => {
  await page.goto("/app/notificacoes");
  await page.waitForURL("**/entrar");
  await expect(page.getByRole("button", { name: "Mandar código" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Não consigo entrar" })).toBeVisible();
});

test("E03_P15_unknown_email_gets_the_same_message_and_no_code", async ({ page }) => {
  const stranger = `e2e-portal-nao-cliente-${tag}@teste.local`;
  await clearMail(stranger);
  await page.goto("/entrar");
  await page.getByRole("textbox", { name: "E-mail", exact: true }).fill(stranger);
  await page.getByRole("button", { name: "Mandar código" }).click();
  await expect(page.getByRole("status")).toHaveText(SENT);
  expect(await mailCode(stranger, 3000)).toBeNull();
  await page.getByLabel("Código", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Código errado. Confira e tente de novo.");
});

test("E03_E05_A03_W01_W09_dono_logs_in_sees_the_month_sets_notices_and_the_session_lasts_30_days", async ({ page }) => {
  const db = adminDb();
  const since = new Date().toISOString();
  await loginToPortal(page, DONO_EMAIL);

  // E03: a portal session row, and security_event for the new device (the seed has the Dono's other devices).
  const dono = sid("p:g02-dono");
  const { data: device } = await db.from("session_device").select("id, surface").eq("person_id", dono).gte("created_at", since).single();
  expect(device!.surface).toBe("portal");
  const { data: notice } = await db.from("notification").select("channel").eq("person_id", dono).eq("notice_code", "security_event").gte("created_at", since);
  expect(notice).toContainEqual({ channel: "email" });

  // W01: all kitchens of Grupo Exemplo; numbers equal C08 (REP-05).
  const all = await closeSums(["s1", "s2", "s3", "s4", "s5"]);
  await expect(page.getByRole("heading", { name: "Setembro de 2026" })).toBeVisible();
  await expect(page.getByText("vendido no delivery").locator("..")).toContainText(reais(all.gross));
  await expect(page.getByText(/^recebido dos apps/).locator("..")).toContainText(reais(all.payout));
  await expect(page.getByRole("combobox", { name: "Cozinha" })).toContainText("Todas (2)");
  await expect(page.getByRole("cell", { name: "Zona Sul · iFood" })).toBeVisible();
  await expect(page.getByText("dados fictícios").last()).toBeVisible();

  // E05, W08: turn WhatsApp on for the weekly summary; the locked security notice cannot be changed.
  await page.goto("/app/notificacoes");
  await expect(page.getByRole("heading", { name: "Notificações" })).toBeVisible();
  await expect(page.getByText("Horário de silêncio: nada por WhatsApp entre 22h e 8h.")).toBeVisible();
  const locked = page.getByRole("checkbox", { name: "Pessoa nova ou login em aparelho novo por e-mail" });
  await expect(locked).toBeChecked();
  await expect(locked).toBeDisabled();
  const weekly = page.getByRole("checkbox", { name: "Resumo da semana por WhatsApp" });
  await expect(weekly).not.toBeChecked();
  await weekly.check();
  await expect
    .poll(async () => (await db.from("notice_pref").select("whatsapp").eq("person_id", dono).eq("notice_code", "weekly_summary").maybeSingle()).data?.whatsapp)
    .toBe(true);
  const { data: audit } = await db.from("audit_log").select("action").eq("actor_person_id", dono).eq("action", "notice_pref.update").gte("at", since);
  expect(audit!.length).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Resumo da semana por WhatsApp" })).toBeChecked();
  await page.getByRole("checkbox", { name: "Resumo da semana por WhatsApp" }).uncheck();
  await expect
    .poll(async () => (await db.from("notice_pref").select("whatsapp").eq("person_id", dono).eq("notice_code", "weekly_summary").maybeSingle()).data?.whatsapp)
    .toBe(false);

  // W09: this device first, the seed devices after; the Dono sees the access log.
  await page.goto("/app/seguranca");
  await expect(page.getByRole("heading", { name: "Segurança e acesso" })).toBeVisible();
  await expect(page.getByText("este aparelho")).toBeVisible();
  await expect(page.getByText("Celular Android")).toBeVisible();
  await expect(page.getByText("Registro de acesso")).toBeVisible();
  await expect(page.getByText("Você entrou com código por e-mail").first()).toBeVisible();

  // Shell (05 §B): every MenuDono link opens its page inside the one menu, and W07 (not in the menu) too.
  await page.setViewportSize({ width: 1280, height: 900 });
  const menu = page.getByRole("navigation", { name: "Portal do dono" });
  const links = await menu.getByRole("link").evaluateAll((as) => as.map((a) => [a.textContent ?? "", a.getAttribute("href") ?? ""]));
  expect(links.map(([, href]) => href)).toEqual(["/app", "/app/lojas", "/app/contestacoes", "/app/pessoas", "/app/plano", "/app/notificacoes", "/app/seguranca"]);
  for (const [label, href] of [...links, ["", "/app/conectar"]]) {
    const res = await page.goto(href);
    expect(res!.status(), href).toBe(200);
    await expect(page.getByRole("navigation", { name: "Portal do dono" }), href).toHaveCount(1);
    await expect(page.getByRole("banner"), href).toHaveCount(1);
    if (label) await expect(menu.getByRole("link", { name: label, exact: true }), href).toHaveAttribute("aria-current", "page");
  }

  // W07 step 2 (m2.extensao_chrome on for G-02): the pairing code for P04, through /api/extension/code.
  await page.getByRole("button", { name: "Mostrar o código da extensão" }).click();
  await expect(page.locator("[data-pairing-code]")).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const { data: tokens } = await db.from("extension_token").select("id, account_id").eq("person_id", dono).is("paired_at", null).gte("created_at", since);
  expect(tokens!.map((t) => t.account_id)).toEqual([sid("G-02")]);
  await db.from("extension_token").delete().in("id", tokens!.map((t) => t.id));

  // E03: 30 days on the portal, then back to P15.
  await db.from("session_device").update({ created_at: new Date(Date.now() - 29 * 86_400_000).toISOString() }).eq("id", device!.id);
  await page.goto("/app");
  expect(page.url()).toMatch(/\/app$/);
  await db.from("session_device").update({ created_at: new Date(Date.now() - 30 * 86_400_000 - 60_000).toISOString() }).eq("id", device!.id);
  await page.goto("/app");
  await page.waitForURL("**/entrar");
});

test("A03_gerente_do_centro_sees_only_cozinha_centro_numbers", async ({ page }) => {
  const email = `e2e-gerente-${tag}@teste.local`;
  const undo = await withLoginEmail(sid("p:g02-ger"), email);
  try {
    await loginToPortal(page, email);
    const centro = await closeSums(["s1", "s2", "s3"]);
    await expect(page.getByText("vendido no delivery").locator("..")).toContainText(reais(centro.gross));
    await expect(page.getByText(/^recebido dos apps/).locator("..")).toContainText(reais(centro.payout));
    const select = page.getByRole("combobox", { name: "Cozinha" });
    await expect(select.locator("option")).toHaveText(["Centro"]);
    await expect(page.getByRole("cell", { name: "Centro · iFood" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /Zona Sul/ })).toHaveCount(0);
    await expect(page.getByText("Relatórios")).toHaveCount(0);
    await expect(page.getByText("Teste grátis")).toHaveCount(0);

    // Asking for another kitchen by URL changes nothing; the account PDF answers 404.
    await page.goto(`/app?cozinha=${sid("G-02:zonasul")}`);
    await expect(page.getByText("vendido no delivery").locator("..")).toContainText(reais(centro.gross));
    await expect(page.getByRole("cell", { name: /Zona Sul/ })).toHaveCount(0);
    const pdf = await page.request.get(`/app/relatorios/fechamento/${sid("G-02:close:2026-09")}/pdf`);
    expect(pdf.status()).toBe(404);

    // W09 without the Dono's access log.
    await page.goto("/app/seguranca");
    await expect(page.getByText("Registro de acesso")).toHaveCount(0);
  } finally {
    await undo();
  }
});

test("P07_sign_up_to_trial_on_the_phone_then_code_then_P08", async ({ page }) => {
  const db = adminDb();
  const email = `e2e-criar-${tag}@teste.local`;
  await clearMail(email);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/criar-conta");
  await expect(page.getByRole("heading", { name: "Crie sua conta" })).toBeVisible();
  await page.getByLabel("Seu nome").fill("Pessoa de teste");
  await page.getByLabel("Restaurante").fill(`Restaurante e2e ${tag}`);
  const cnpj = syntheticCnpj();
  await page.getByLabel("CNPJ da loja").fill(cnpj.slice(0, 13) + String((Number(cnpj[13]) + 1) % 10));
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("checkbox").check();
  const start = page.getByRole("button", { name: "Começar meus 14 dias grátis" });
  await start.click();
  await expect(page.getByRole("status")).toHaveText(/Confira o CNPJ|Para continuar/);
  await page.getByLabel("CNPJ da loja").fill(cnpj);
  await start.click();
  await expect(page.getByRole("status")).toHaveText(SENT);
  const code = await mailCode(email);
  expect(code).not.toBeNull();
  try {
    await page.getByLabel("Código", { exact: true }).fill(code!);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.waitForURL(/\/app$/);
    await expect(page.getByRole("heading", { name: `Restaurante e2e ${tag}` })).toBeVisible();
    await expect(page.getByText("faltam 14 dias", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Escolher um plano" })).toBeVisible();
    const { data: acc } = await db.from("account").select("subscription(status), trial_ends_at").eq("name", `Restaurante e2e ${tag}`).single();
    expect(acc!.subscription).toMatchObject({ status: "trial" });
    expect(acc!.trial_ends_at).not.toBeNull();
  } finally {
    const { data: p } = await db.from("person").select("id, auth_user_id, membership(account_id)").eq("email", email).maybeSingle();
    if (p) {
      for (const m of p.membership) await db.from("account").delete().eq("id", m.account_id);
      await db.from("person").delete().eq("id", p.id);
      if (p.auth_user_id) await db.auth.admin.deleteUser(p.auth_user_id);
    }
    await db.from("auth_code_guard").delete().eq("email", email);
  }
});

test("P18_accept_invite_logs_in_and_the_link_then_shows_the_clear_message", async ({ page }) => {
  const db = adminDb();
  const email = `e2e-convite-${tag}@teste.local`;
  const token = `e2e-${tag}-${randomBytes(8).toString("hex")}`;
  const { data: inv } = await db
    .from("invite")
    .insert({
      account_id: sid("G-02"),
      role: "gerente",
      kitchen_ids: [sid("G-02:centro")],
      channel: "email",
      destination: email,
      token_hash: createHash("sha256").update(token).digest("hex"),
      invited_by: sid("p:g02-dono"),
    })
    .select("id")
    .single();
  try {
    await page.goto(`/convite/${token}`);
    await expect(page.getByRole("heading", { name: "Dono do grupo convidou você para o Grupo Exemplo" })).toBeVisible();
    await expect(page.getByText("Gerente de cozinha")).toBeVisible();
    await expect(page.getByText("Você vai ver o fechamento, as contestações e as notas da Cozinha Centro. Não vê cobrança nem outras cozinhas.")).toBeVisible();
    await page.getByLabel("Seu nome").fill("Gerente convidado");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Aceitar e entrar" }).click();
    await page.waitForURL(/\/app$/);
    await expect(page.getByRole("cell", { name: "Centro · iFood" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /Zona Sul/ })).toHaveCount(0);

    await page.goto(`/convite/${token}`);
    await expect(page.getByRole("heading", { name: "Convite inválido" })).toBeVisible();
    await expect(page.getByText("Grupo Exemplo")).toHaveCount(0);
  } finally {
    const { data: p } = await db.from("person").select("id, auth_user_id").eq("email", email).maybeSingle();
    if (p) {
      await db.from("person").delete().eq("id", p.id);
      if (p.auth_user_id) await db.auth.admin.deleteUser(p.auth_user_id);
    }
    await db.from("invite").delete().eq("id", inv!.id);
  }
});

// W09 for the Dono of Pantanos (G-01): data export (E06), deletion with a code (E06), then "Trocar" the
// login e-mail with a code on the new address (E04). Everything the test queues or changes is undone.
test("E04_E06_W09_dono_exports_asks_deletion_with_code_and_changes_login_email", async ({ page }) => {
  test.setTimeout(240_000);
  const db = adminDb();
  const since = new Date().toISOString();
  const G01 = sid("G-01");
  const dono = sid("p:g01-dono");
  const newEmail = `e2e-troca-${tag}@teste.local`;
  await loginToPortal(page, PANTANOS_EMAIL);
  const { data: me } = await db.from("person").select("auth_user_id").eq("id", dono).single();
  try {
    await page.goto("/app/seguranca");

    // E06 export: queued, audited, then "em preparação" on the page.
    await page.getByRole("button", { name: "Baixar todos os meus dados" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Estamos preparando o arquivo" })).toBeVisible();
    const { data: exp } = await db.from("job").select("id, status").eq("type", "account_export").eq("account_id", G01).gte("created_at", since);
    expect(exp).toHaveLength(1);
    await page.reload();
    await expect(page.getByText(/^Arquivo de .* em preparação\.$/)).toBeVisible();

    // E06 deletion: a code on the Dono's e-mail; a wrong one is refused, the right one queues account_delete.
    await waitForResendWindow(PANTANOS_EMAIL);
    await clearMail(PANTANOS_EMAIL);
    await page.getByRole("button", { name: "Excluir a conta e os dados" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Mandamos um código" })).toBeVisible();
    const delCode = await mailCode(PANTANOS_EMAIL);
    expect(delCode, "deletion code in Mailpit").not.toBeNull();
    await page.locator("#w09-codigo-excluir").fill(delCode === "000000" ? "111111" : "000000");
    await page.getByRole("button", { name: "Confirmar a exclusão" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Código errado" })).toBeVisible();
    await page.locator("#w09-codigo-excluir").fill(delCode!);
    await page.getByRole("button", { name: "Confirmar a exclusão" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Pedido de exclusão recebido" })).toBeVisible();
    const { data: del } = await db.from("job").select("payload").eq("type", "account_delete").gte("created_at", since);
    expect(del).toEqual([{ payload: { account_id: G01, requested_by: dono } }]);
    // The check did not replace the portal session.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Segurança e acesso" })).toBeVisible();

    // E04: "Trocar" the e-mail, code on the new address, 24-hour lock, notice to the old address.
    await clearMail(newEmail);
    await page.getByRole("button", { name: "Trocar" }).first().click();
    await page.getByLabel("Novo e-mail").fill(newEmail);
    await page.getByRole("button", { name: "Mandar código" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Mandamos um código" })).toBeVisible();
    const code = await mailCode(newEmail);
    expect(code, "code at the new address").not.toBeNull();
    await page.locator("#w09-codigo-email").fill(code!);
    await page.getByRole("button", { name: "Confirmar troca" }).click();
    await expect(page.getByRole("status").filter({ hasText: "E-mail trocado" })).toBeVisible();
    expect((await db.from("person").select("email, auth_user_id").eq("id", dono).single()).data).toEqual({ email: newEmail, auth_user_id: me!.auth_user_id });
    const { data: lock } = await db.from("security_lock").select("reason").eq("account_id", G01).gte("created_at", since);
    expect(lock).toEqual([{ reason: "contact_change:email" }]);
    const { data: told } = await db.from("notification").select("recipient").eq("person_id", dono).eq("subject", "Seu e-mail de login mudou").gte("created_at", since);
    expect(told).toEqual([{ recipient: PANTANOS_EMAIL }]);
    // Still signed in, now under the new e-mail.
    await page.reload();
    await expect(page.getByText(`E-mail: ${newEmail}`)).toBeVisible();
  } finally {
    await db.from("person").update({ email: PANTANOS_EMAIL }).eq("id", dono);
    if (me?.auth_user_id) await db.auth.admin.updateUserById(me.auth_user_id, { email: PANTANOS_EMAIL, email_confirm: true });
    await db.from("security_lock").delete().eq("account_id", G01).gte("created_at", since);
    await db.from("job").delete().in("type", ["account_export", "account_delete"]).gte("created_at", since);
    await db.from("notification").delete().eq("notice_code", "security_event").gte("created_at", since);
    await db.from("auth_code_guard").delete().eq("email", newEmail);
  }
});
