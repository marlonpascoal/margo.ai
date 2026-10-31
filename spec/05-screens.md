# 05. Screens

The screens and the spec are one thing. Every screen drawn in the canvas "MargoAI: todas as telas" (https://claude.ai/artifact/AYwbRTZyGH2bUQ6LSwH8ve) is in `design/` as `<code>-<name>.dc.html`, and every one is specified below. The drawing is the reference for **layout, copy and states**; the text below is the reference for **behavior, data and permissions**. Copy on screen is used verbatim (Portuguese), replacing only the fictitious numbers with real data. The flow map is `design/Main.dc.html`.

How to read each entry:
- **Route**: Next.js path. Owner pages are responsive: the P drawing is the phone layout and the W drawing is the computer layout of the same route (D32).
- **Who**: roles allowed (04-rules §5). Anyone else gets 404, not 403.
- **Shows / Actions**: data and what each button does.
- **Rules, flags**: IDs from 04-rules.
- **Done when**: the acceptance checks for this screen (also listed in 07-acceptance).

Shared components: `design/Menu.dc.html` (console sidebar, groups: Clientes e cobrança C21, C01, C15, C19, C18; Módulo 1 C02 to C06; Módulo 2 C07, C17, C08, C09, C16; Módulo 3 C10 to C13; then C14, C20; items without permission are hidden) and `design/MenuDono.dc.html` (owner top menu: Início, Lojas, Contestações, Pessoas, Plano e cobrança, Notificações, Segurança; on phone it becomes the P08 list).

Every screen shows the label `dados fictícios` only when rendering the seed; real data never shows it, synthetic accounts show `SINTÉTICO`.

---

## 0. Entry point: landing page (D38)

- The ad-test landing page (`margoai-lp`, first card on the map) stays a static page. Its form posts to `/api/leads` (name, restaurant, iFood link, WhatsApp), rate-limited, which creates a lead shown in C01 with "Próximo passo: raio-X" and prefills C02 with the iFood link.
- **Done when** a lead appears in C01 within a minute and opening it lands on C02 with the link filled.

## A. Console (founders)

### C00. Login do console
- **Route** `/console/login` · **Who** invited staff e-mails.
- **Shows** e-mail field, code field, explanation text as drawn.
- **Actions** "Entrar": sends e-mail code; on valid code, opens C01 with the role from `staff`.
- **Rules** 04 §8 (12-hour session), audit every action.
- **Done when** a non-invited e-mail gets the same neutral message as an invited one (no account enumeration) and no code is sent; an Operação user never sees C14, C15 prices, C20.

### C01. Clientes
- **Route** `/console` · **Who** Fundador, Operação.
- **Shows** KPI cards (restaurants in funnel, X-rays delivered, accounts with iFood connected, hours logged this month from `time_log`); table of accounts and leads with status per module and "Próximo passo".
- **Actions** "Novo raio-X" opens C02; row click opens the account (C19 for structure, C07 for imports).
- **Done when** the four KPIs match SQL counts on the seed; each module status comes from data, not text.

### C02. Novo raio-X (M1 step 1 of 4)
- **Route** `/console/raio-x/novo` · **Who** staff · **Flag** `m1.raio_x`.
- **Shows** iFood store link field; store found (name, area, category) after paste; radius options 3 (default), 2, 5 km; categories; the three competitive-set toggles.
- **Actions** "Buscar vizinhança" creates `xray` and a `collect` job (worker-collector, D47), then opens C03 in `collecting` state with progress; "Cancelar".
- **Rules** M1-01, M1-02. URL parsing extracts the iFood uuid at the end of the URL (D29).
- **Done when** an invalid or non-iFood URL is rejected inline; the job respects the 3-second rate and stops on a block, showing the reason.

### C03. Vizinhança de 3 km (step 2)
- **Route** `/console/raio-x/[id]/vizinhanca`.
- **Shows** count found, in set, excluded; list with name, distance, reason for exclusion; map placeholder (real map optional, not V1).
- **Actions** toggle a store in or out (writes `xray_store.included`, reason `manual`); "Confirmar N lojas" starts pairing and opens C04.
- **Done when** counts update live and the excluded reason is shown for every excluded store.

### C04. Pareamento de itens (step 3)
- **Route** `/console/raio-x/[id]/pareamento`.
- **Shows** totals (items, auto-paired, to review, normalized by weight); table: own item, number of comparables, unit, example pair, status.
- **Actions** open a row to accept or reject pairs; "Calcular raio-X" (disabled while any `revisar` remains unless the founder marks it skipped) opens C05.
- **Rules** M1-03, M1-04.
- **Done when** a weight-sold item shows its normalized unit and price; skipped items are excluded from parity and listed in the PDF footnote.

### C05. Raio-X de preço (step 4)
- **Route** `/console/raio-x/[id]`.
- **Shows** KPIs, table (item, own price, parity, gap, reading), Pareto sentence "N de M itens somam 80% da perda por preço", the method note.
- **Actions** "Rever pares" back to C04; "Preparar entrega" renders P01 (worker-render) and opens C06.
- **Rules** M1-05 to M1-08.
- **Done when** parity equals the median of accepted pairs in a unit test with the seed, and the Pareto count is computed, not typed.

### C06. Entrega ao dono
- **Route** `/console/raio-x/[id]/entrega`.
- **Shows** the PDF (P01) with "Abrir o PDF"; the WhatsApp message (editable) with the authorization link (`/criar-conta?ref=<xray>`); hour fields per step.
- **Actions** "Enviar pelo WhatsApp" opens click-to-chat with the text (manual send, D36) and sets `xray.status=delivered`; "Salvar e voltar" saves hours to `time_log`.
- **Done when** the link carries the X-ray reference so the sign-up (P07) links the new account to the public store (D29).

### C07. Conectar e importar (M2)
- **Route** `/console/contas/[code]/importacoes` · **Flags** `m2.ifood_api`, `m2.extensao_chrome`, `m2.arquivo_ifood`, `m2.arquivo_99food`.
- **Shows** queue status (running, queued); three source cards: iFood API (schedule, authorized stores, next run), Chrome extension (last upload, staleness warning), Files (drop zone; 99Food, iFood export and others); import history table (when, trigger, channel and source, stores, period, rows, duration, status, actions) with filters by channel and status; count line "Mostrando N de M importações desde ...".
- **Actions** drop file creates `import_run` and a job; "Rerun" on a row; "Ver o que o dono autorizou" shows `owner_authorization`; "Ver fechamento" opens C08; failed rows link to C17 when `needs_mapping`.
- **Rules** 04 §11; refuses real files without authorization.
- **Done when** re-importing the same file adds zero new rows and shows them as duplicates; history pagination works over 200 runs.

### C17. Corrigir importação
- **Route** `/console/importacoes/[id]/corrigir`.
- **Shows** file name; table of file columns with example value, target field (select, or "ignorar"), status; check block: rows in file, payout total in file, payout total after mapping, "bate" or the gap.
- **Actions** "Salvar e reprocessar" saves `column_mapping` for that file signature and requeues the run.
- **Done when** saving is blocked unless totals match; the next file with the same layout imports without visiting C17.

### C08. Fechamento por loja e canal
- **Route** `/console/contas/[code]/fechamento/[yyyy-mm]`.
- **Shows** month selector; summary of differences (count, total, how many certain and probable) with "Ver diferenças"; table per channel: gross, commission, payment, delivery, promotion, anticipation, payout, % of gross; the M3 prompt when cost is missing.
- **Actions** "Ver diferenças" opens C09; "Ir para o módulo 3" opens C10.
- **Rules** REP-01 to REP-05 for expected values; actual values from `ledger_entry`.
- **Done when** the payout column equals the sum of payout entries for the month to the centavo on the seed.

### C09. Diferenças no repasse
- **Route** `/console/contas/[code]/fechamento/[yyyy-mm]/diferencas`.
- **Shows** totals: certain (ready to contest), probable (check with owner), share of gross; table: rule, what happened, channel, orders, value, confidence, contestation status.
- **Actions** "Preparar contestação" opens C16 with selected rows; "Gerar fechamento mensal" renders P06 and the xlsx, sets `close_period.status=computed`, and queues `close_ready` on the 5th or immediately if later.
- **Rules** DIF-01 to DIF-05.
- **Done when** each row links to the orders that produced it (evidence download).

### C16. Contestação
- **Route** `/console/contas/[code]/contestacoes`.
- **Shows** status totals; table: difference, value, status, who marked, next step; the ready claim text for the selected difference; download of the order sheet.
- **Actions** "Mandar ao dono no WhatsApp" (manual link); "Ver o que o dono vê" opens W03 as that account (read-only impersonation, audited); staff can mark `negada` when the owner says so.
- **Rules** 04 §3.
- **Done when** staff cannot set `creditada`; the system sets it when the credit appears and the owner gets `credit_confirmed`.

### C10. Notas de compra (M3)
- **Route** `/console/contas/[code]/notas` · **Flag** `m3.notas_xml`.
- **Shows** accountant zip drop zone with stats (invoices, months, suppliers, NF-e, NFC-e, duplicates); single receipt input (44-digit key or QR link) with check-digit validation; coverage of the top 20 ingredients (N de 20) with missing list.
- **Actions** "Mapear insumos" opens C11; "Pedir nota pelo WhatsApp" opens click-to-chat with the P05 text listing missing ingredients.
- **Done when** duplicates by access key are counted and skipped; an invalid key is rejected before saving.

### C11. De-para de insumos
- **Route** `/console/contas/[code]/de-para` · **Flag** `m3.depara_ia`.
- **Shows** shares of spend matched by barcode or rule, suggested by AI awaiting confirmation, no match; table: invoice description, catalog ingredient, how matched, price, action.
- **Actions** "Confirmar", "Trocar" (search catalog or create ingredient); "Ir para a ficha técnica".
- **Rules** D14: suggestions never count until confirmed; confirmations improve the next client's auto-match.
- **Done when** an unconfirmed suggestion does not affect any cost number.

### C12. Ficha técnica
- **Route** `/console/contas/[code]/fichas`.
- **Shows** progress (N de 20 fichas prontas); dish list with status; selected dish cost with error bar; lines: ingredient, qty, yield, price source, cost; explanation of the error bar.
- **Actions** edit lines; import the recipe xlsx template (D15); "Ver contribuição".
- **Rules** CST-01 to CST-04.
- **Done when** a dish using a regional prior shows a wider error bar than one fully from invoices.

### C13. Contribuição por item e canal
- **Route** `/console/contas/[code]/contribuicao/[yyyy-mm]`.
- **Shows** the highlighted decision sentence (DLV-01); table: item, channel, price, channel take, ingredients, left, % of price; error bar note.
- **Actions** "Gerar fechamento mensal" (as C09); "Aprovação de cupom (depois)" disabled unless `l.aprovacao_cupom`.
- **Rules** CTB-01, CTB-02, DLV-01.
- **Done when** rows that can invert are flagged.

### C14. Configurações
- **Route** `/console/config` · **Who** Fundador.
- **Shows** owner authorizations per CNPJ (scope, AI included, status); secrets status (name and where it lives, never the value); MargoAI staff with roles and "Convidar pessoa da operação"; X-ray defaults (radius, minimum pairs); client data: prod database in São Paulo, client codes, build agents use dev only, worker processing abroad stated in terms; retention after a client leaves (90 or 30 days).
- **Done when** no secret value can reach the browser (checked by an e2e test that greps responses).

### C15. Assinaturas
- **Route** `/console/assinaturas` · **Who** Fundador · **External** Asaas.
- **Shows** KPIs (in trial, paying, monthly revenue, past due); table: account, plan, active units, status, next charge, Asaas id, last event; pilots section (account, % months 1 and 2, cap, from month 3, next charge preview); trial-end policy text; plan editor (prices, trial days, billing unit; D40).
- **Actions** "Novo piloto"; edit plan values (audited).
- **Rules** 04 §7.
- **Done when** a replayed Asaas webhook does not change state twice.

### C18. Parceiros BPO
- **Route** `/console/bpo` · **Flag** `bpo.marca_propria`.
- **Shows** partners with clients, folder status, price per store (Fundador only); brand settings (logo, color, "com tecnologia MargoAI").
- **Actions** "Gerar fechamento com a marca do BPO" renders P06 with the BPO's brand into the partner's folder.
- **Done when** the branded PDF uses only the BPO's logo and color, and the footer follows the toggle.

### C19. Estrutura do cliente
- **Route** `/console/contas/[code]/estrutura`.
- **Shows** counts (CNPJs, kitchens and how many billed, brands, channel stores); table: CNPJ, kitchen, brand, app, id in the app and public URL, source, link status ("sem cozinha", "vinculada").
- **Actions** "Buscar lojas no iFood de novo" (merchant list through the API); link a store to a kitchen.
- **Rules** D29; only linked stores count for close and billing.
- **Done when** a store's URL change keeps the old URL in history and the same `channel_store` row.

### C20. Funcionalidades
- **Route** `/console/funcionalidades` · **Who** Fundador.
- **Shows** env switch (sandbox, production); table: key, what it turns on, default per plan, exceptions.
- **Actions** toggle a default; add an account exception with reason.
- **Rules** 04 §6.
- **Done when** every change writes `feature_flag_log`, and turning a flag off hides its screens and stops its jobs within one minute.

### C21. Alertas
- **Route** `/console/alertas`.
- **Shows** table: severity, alert, client, since, notified via, action link; footer about team and owner channels; "Ver e-mail que o dono recebe" opens E02.
- **Actions** open the linked screen; resolve.
- **Rules** 04 §10.

---

## B. Owner portal (responsive)

### P15 / W06. Entrar (and Criar conta on computer)
- **Route** `/entrar` · **Who** anyone.
- **Shows** phone: tabs WhatsApp or E-mail, code step, links "Usar outro número ou e-mail", "Criar conta grátis", "Não consigo entrar". Computer: product pitch on the left, Entrar and Criar conta tabs on the right.
- **Actions** "Mandar código", "Entrar"; after login with more than one account, choose which to open.
- **Rules** 04 §8.
- **Done when** codes expire at 10 minutes and lock after 5 tries; a login on a new device raises `security_event`.

### P07. Criar conta
- **Route** `/criar-conta` (computer: tab in W06).
- **Shows** name, restaurant, CNPJ, WhatsApp, e-mail, terms checkbox, trial length from `plan.trial_days`.
- **Actions** "Começar meus N dias grátis" creates the account (04 §7) and sends a code; with `?ref=<xray>` links the public store to the new kitchen.
- **Done when** CNPJ is validated (check digits) and the trial end date is stored.

### P17. Não consigo entrar
- **Route** `/nao-consigo-entrar`.
- **Shows** the four options as drawn (code did not arrive; changed WhatsApp; lost both; someone got in).
- **Actions** each option links to P15, W09 or the founders' verification request (creates an alert).

### P18. Aceitar convite
- **Route** `/convite/[token]`.
- **Shows** who invited, profile, kitchens, what this profile sees, name field, terms.
- **Actions** "Aceitar e entrar" creates `membership` and logs in.
- **Done when** an expired or used token shows a clear message and no data about the account.

### P08 / W01. Início (phone: Minha conta)
- **Route** `/app` · **Who** all profiles (data filtered by scope).
- **Shows** phone (P08): trial banner, latest reports, links to stores, people, contestations, connections status, notifications, security, terms, revoke access, delete data. Computer (W01): trial banner, month and kitchen selector, KPIs (sold, received, left after ingredients, charged wrong), table per kitchen and app, reports (closing PDF, X-ray PDF), the month's decision.
- **Rules** CTB-01, DLV-01. Gerente sees only own kitchens; plan banner only for Dono.
- **Done when** the KPIs equal C08 and C13 for the same month and scope.

### P13 / W02. Lojas
- **Route** `/app/lojas`.
- **Shows** account summary (CNPJs, kitchens, stores); kitchens with CNPJ, stores per app with "ver no app" link (public URL), data arriving status, in-analysis toggle; banner for a new iFood store without kitchen with a kitchen picker; note that 99Food stores appear after the first statement.
- **Actions** "Confirmar e convidar a equipe" (first run), toggle in analysis (Dono only; changes `units_billed` at next charge), choose kitchen for a new store, "Conectar apps e extensão" opens W07.
- **Done when** the bill preview updates with the number of kitchens in analysis.

### P12 / W03. Contestações
- **Route** `/app/contestacoes` · **Flag** `m2.contestacao`.
- **Shows** totals (to contest, in analysis, came back, needs your answer); list: what happened, kitchen and app, value, status pill, deadline or protocol, action.
- **Actions** "Copiar texto", "Já contestei" (asks optional protocol), "Foi negada", "Foi combinado? Sim / Não".
- **Rules** 04 §3.
- **Done when** each button moves the status as in the state machine and is audited; the owner cannot set `creditada`.

### P14 / W04. Pessoas e acessos
- **Route** `/app/pessoas` · **Who** Dono (others see only themselves) · **Flag** `conta.pessoas`.
- **Shows** people with profile, kitchens, last access, actions; permission matrix as in 04 §5.
- **Actions** "Convidar pessoa" (WhatsApp or e-mail, profile, kitchens), change profile, remove, resend invite.
- **Done when** removing or demoting the last Dono is refused, and changes are blocked during a `security_lock`.

### P09 / W05. Plano e cobrança
- **Route** `/app/plano` · **Who** Dono.
- **Shows** trial end; plans from the `plan` table (Raio-X free, Lucro per kitchen per month with the computed total, Rede by conversation; "preços de exemplo" until prices are set); invoices list.
- **Actions** "Assinar pelo Asaas" opens the hosted checkout (P10); "Ficar no grátis"; "Falar com a gente" creates an alert.
- **Done when** the total equals price times kitchens in analysis.

### P10. Pagamento (Asaas hosted checkout)
- Not built by us. Asaas hosts it; card data never touches MargoAI (D27). After payment Asaas returns the person to `/app/plano?status=...` and confirms by webhook. The page shows "processando" until the webhook arrives.

### P03 / W07. Conectar os apps
- **Route** `/app/conectar` · **Flags** `m2.ifood_api`, `m2.extensao_chrome`.
- **Shows** what we read and never do; terms acceptance (AI processing and international processing included, D48); step 1: authorize in the iFood Partner Portal (Aplicativos, Permitir), with status "feito em ..." once `merchant` list returns stores; step 2: install the extension (computer only; on phone, "Mandar o link para abrir no computador").
- **Actions** "Abrir o Portal do Parceiro"; "Ver as lojas encontradas" opens W02; "Adicionar ao Chrome" opens the Web Store listing.
- **Done when** acceptance creates `owner_authorization` for the CNPJ, and the page detects a new authorization within 5 minutes (polling the merchant list).

### P04. Extensão do Chrome (popup)
- **Where** `extension/`, popup on the Partner Portal tab.
- **Shows** connected status; store detected; reports MargoAI asked for, each with period; last upload.
- **Actions** "Exportar e enviar": clicks the portal's Export button on the open page, waits for the download, uploads to `/api/ext/upload` with the extension token.
- **Rules** reads only the page the owner opened; never reads or stores the password; no background browsing of other pages (D01a). Runs only while the portal tab is open.
- **Done when** the extension has host permission only for the Partner Portal domain and our API domain.

### P16 / W08. Notificações
- **Route** `/app/notificacoes`.
- **Shows** contact e-mail and WhatsApp; table of the 10 notices (04 §9) with who and when, e-mail and WhatsApp toggles; locked toggles for billing and security; quiet-hours note; "Ver exemplo de e-mail".
- **Done when** a locked toggle cannot be turned off through the API either.

### W09. Segurança e acesso (phone: reached from P08)
- **Route** `/app/seguranca`.
- **Shows** login contacts with "Trocar"; connected devices; "Sair de todos os aparelhos"; access log; data section: how to revoke iFood, "Baixar todos os meus dados", "Excluir a conta e os dados" (Dono, code confirmation, deletion within 90 days).
- **Done when** export produces a zip of the account's data (CSV per table plus files) and deletion schedules the deletion job and confirms by e-mail.

### P11. Termos e privacidade
- **Route** `/termos` (public).
- **Shows** summary items as drawn (what we read, why, who processes including AI and abroad, how long, how to revoke, how to delete); full text from `docs/legal/` after legal review (D48).

---

## C. Documents, messages and e-mails

| Code | What | Generated by | Done when |
|---|---|---|---|
| P01 | Raio-X PDF, A4, 1 to 2 pages | worker-render from `xray` | numbers match C05; footnote states source and method |
| P02 | WhatsApp message with the X-ray and sign-up link | text template in C06 | link carries `?ref` |
| P05 | WhatsApp request for missing invoices, and the reply after a QR is read | text template in C10 | lists only missing top-20 ingredients |
| P06 | Monthly closing PDF, A4, plus xlsx | worker-render from `close_period`, `contribution`, `contestation` | totals equal C08; BPO variant uses the BPO's brand |
| E01 | E-mail "fechamento do mês pronto" | notifier, `close_ready` | subject and numbers from the close; PDF attached; footer explains why received |
| E02 | E-mail "prazo de contestação" | notifier, `deadline_soon` | sent 3 days before; links to the claim text in W03 |

---

## D. After 15/fev (built behind flags, off; design only now)

| Code | What | Flag |
|---|---|---|
| L01 | Painel do dono (live month, "pede sua decisão") | `l.painel_dono` |
| L02 | Aprovação de cupom on WhatsApp | `l.aprovacao_cupom` |

Not built in V1. Keep the routes reserved (`/app/painel`, `/app/cupom/[id]`) and the data model able to answer them.

---

## E. Coverage check

Screens in `design/`: C00 to C21 (22), P01 to P18 (18), W01 to W09 (9), E01, E02, L01, L02, plus Menu, MenuDono and Main. Every code above appears exactly once as a heading or table row; `scripts/check_screens.py` fails the build if a `design/*.dc.html` file has no entry in this document.
