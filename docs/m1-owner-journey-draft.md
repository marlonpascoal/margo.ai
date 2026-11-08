# Draft: the price X-ray in the owner portal (M1 owner journey)

Status: **draft for Marlon's approval**. Nothing here changes `spec/`, `docs/decisions.md` or `design/` until approved. Proposed rows to paste are at the end. Prototype (fictitious data): `m1-owner-journey.html` in the session scratchpad, hash routes `#monitoramentos`, `#novo`, `#lendo`, `#revisar`, `#resultado`, `#historico`, `#avisos`.

Marlon's decisions (07/nov) this draft implements:
1. The whole X-ray journey moves to the owner portal: start an X-ray of an own store or a competitor, follow the capture, review items, see the result. The console keeps it for support.
2. Item review is done by the owner, in plain language: the system confirms identical items, the owner sees only the doubtful ones, with the suggestion pre-marked and "Confirmar todas as sugestões".
3. A list of active **monitorings** (own stores and competitors), each with a period, last and next capture, status, history, pause, resume and remove, within plan limits.
4. The waiting time (captures take minutes to hours) is a first-class screen with steps, live counts, an honest time range and something useful to look at.

---

## 1. Words: what the owner reads instead of internal terms

| Internal (code, console) | Owner sees (pt-BR) |
|---|---|
| X-ray run, `xray` | raio-X (one dated result) |
| monitoring | acompanhamento; list title "Lojas que você acompanha" |
| pairing, `xray_pair`, similarity | comparação; "é o mesmo produto que o seu?" |
| `auto` pair | "confirmado pelo sistema" |
| `revisar` | "em dúvida" |
| `min_pairs`, "poucos pares" | "Poucas lojas vendem algo parecido" |
| "nenhum item parecido", no parity | "item só seu" |
| parity, `parity_cents` | "preço da vizinhança" (P01 already says "Vizinhança") |
| gap | "diferença" |
| `pode_subir` / `na_media` / `nao_mexer` | "pode subir" / "na média" / "não mexa sem saber o custo" (P01 wording) |
| capture, extract job | "ler o cardápio" |
| discovery, neighborhood job | "buscar a vizinhança" |
| beyond the cap (M1-11) | "fora das 30 mais relevantes" |
| failed capture | "não deu para ler agora" |
| M1-10 price index, rank | "posição de preço": "4ª mais barata de 31" |

Never shown to owners: similarity numbers, `min_pairs`, block, captcha, scraper, Bright Data, iFood defenses, rating values, street addresses (D47c).

---

## 2. Screens

Codes follow 05's owner convention: a P code (phone) and a W code (computer) for one responsive route (D32). P19 to P24 and W10 to W15 are free; C22 and E03 are free.

| Code | Name (pt-BR title) | Route | Replaces or extends |
|---|---|---|---|
| P19 / W10 | Raio-X de preço: lojas que você acompanha | `/app/raio-x` | New top item "Raio-X" in MenuDono, between Início and Lojas. Replaces the "Raio-X de preço" PDF link on P08 and the W01 report link (both now open P19/W10) |
| P20 / W11 | Acompanhar uma loja | `/app/raio-x/novo` | Owner version of C02 |
| P21 / W12 | Lendo os cardápios (waiting) | `/app/raio-x/[monitor]/lendo` | Owner version of C03; adds steps, time range, partial view |
| P22 / W13 | Itens em dúvida | `/app/raio-x/[monitor]/revisar` | Owner version of C04, doubtful items only |
| P23 / W14 | Resultado do raio-X | `/app/raio-x/[monitor]` (latest), `/app/raio-x/[monitor]/[xray]` (a past one) | Owner version of C05 plus M1-10 position; "Baixar PDF" renders P01 |
| P24 / W15 | Histórico | `/app/raio-x/[monitor]/historico` | New: M1-10 position over time and price per item over time |
| C22 | Acompanhamentos (console) | `/console/raio-x/acompanhamentos` | New list across accounts for support. Menu group "Módulo 1" gains it before C02 |
| E03 | E-mail "Seu raio-X está pronto" | notifier | Same layout as E01 |

`/app/relatorios/raio-x` (built, the PDF route) stays and is what "Baixar PDF" calls.

### 2.1 Permissions (04 §5 style), proposed rows

| Action | Dono | Financeiro | Gerente de cozinha |
|---|---|---|---|
| See monitorings, waiting screen, results, history, PDF | yes | yes | own kitchens only (own stores of their kitchens; competitors linked to their kitchens) |
| Start, pause, resume, remove a monitoring; change its period | yes | no | no |
| Take a store out of a run's comparison | yes | no | no |
| Answer "é o mesmo produto que o seu?" (review) | yes | no | **proposed yes**, own kitchens only |
| Undo a system confirmation ("não é o mesmo") | yes | no | proposed yes, own kitchens only |

Why the Gerente may review: the kitchen manager knows the menu best, and review changes no plan, cost or limit. Every decision writes `audit_log` (who, monitor, item, the candidate items, before and after) and the decision row keeps `decided_by`. Everyone else gets 404, not 403 (05 convention). Plan banners and limit prompts show to Dono only.

### 2.2 Flags

| Flag | Gates | Default proposal |
|---|---|---|
| `m1.raio_x` (exists) | P19 to P24, W10 to W15 | as today |
| `m1.portal` (**new**) | The owner journey as a whole (menu item, routes, E03, the new notices) | **off in all plans until the legal consult D01b clears owner-facing competitor data**; then Raio-X on (own store only), Lucro on, Rede on |
| `m1.concorrente` (exists) | Competitor monitorings (P20 "Concorrente", competitor rows) | as today: off Raio-X, on Lucro, Rede |
| `m1.extracao` (exists) | Captures. When off, monitorings stay but nothing is read; P19 rows show "Leitura automática desligada" and C21 gets an alert | as today |

### 2.3 P19 / W10. Lojas que você acompanha

| | |
|---|---|
| **Shows** | Plan line: "Plano Lucro · Suas lojas: 2 · Concorrentes ativos: 2 de 3 · 1 nova este mês de 3". Two groups, "Suas lojas" and "Concorrentes". Each row: store name, area, kitchen (for competitors, "perto de Centro"), period ("toda semana"), last reading, next reading, status pill, M1-10 position with change since the previous run ("4ª de 31, subiu 2"), pending items count. Links "Ver resultado", "Histórico" |
| **Status pills** | `em dia`; `lendo cardápios 27 de 31` (links to P21); `espera você: 9 itens` (links to P22); `pausado por você`; `pausado pelo plano`; `não deu para ler` (all attempts failed, founders alerted); `loja fora do ar` (target not found or closed 30 days); `leitura automática desligada` (`m1.extracao` off) |
| **Actions** | "Acompanhar uma loja" (P20); per row menu "Pausar", "Retomar", "Mudar frequência", "Remover" (confirm: "Remover o acompanhamento? O histórico continua guardado."). Dono only |
| **Rules** | Limits §3.3; M1-10 for the position |
| **States** | Empty: "Você ainda não acompanha nenhuma loja." with "Acompanhar minha loja" (own store prefilled from `channel_store`). Loading: skeleton rows. Updating row: progress bar and "lendo cardápios 27 de 31, cerca de 10 a 20 min". Error loading list: "Não conseguimos carregar agora. Tente de novo." Limit reached: "Acompanhar uma loja" still open for own stores; competitor option shows the limit |
| **Done when** | Counts in the plan line equal the server's limit check; a Financeiro sees no action buttons; a Gerente sees only rows of their kitchens |

### 2.4 P20 / W11. Acompanhar uma loja

| | |
|---|---|
| **Shows** | Choice "Uma loja minha" (list of the account's iFood `channel_store` rows, no link needed) or "Um concorrente" (field "Link da loja no iFood"; after paste, "Loja encontrada: Concorrente D · Bairro Exemplo · Lanches"; a link that is one of the account's own stores switches to "Esta loja é sua"). For a competitor: "Perto de qual cozinha?" (sets `kitchen_id`, drives Gerente scope and the default neighborhood). Frequency: "Toda semana (recomendado)", "A cada 2 semanas", "Todo mês" (only values at or above the plan minimum). Radius 3 km (padrão), 2, 5. "Ajustes da comparação" collapsed: categories (prefilled from the store), the three C02 toggles with C02 defaults. Cost line: "Conta como 1 dos 3 concorrentes do seu plano. Restam 1 este mês." |
| **Actions** | "Começar a acompanhar": creates the monitoring and its first `xray`, queues discovery, opens P21. "Cancelar" |
| **Rules** | M1-01, M1-02; D29 URL parsing; limits §3.3 checked on the server (`competitor_xray_limit`, new monitor limits) |
| **States** | Invalid or non-iFood link: inline "Este link não é de uma loja do iFood." Store not found: "Não achamos esta loja. Confira o link." Already monitored: "Você já acompanha esta loja" with link. Limit reached: form disabled for competitors, "Seu plano permite 3 concorrentes ao mesmo tempo. Pause ou remova um, ou veja os planos." (Dono: link W05). Raio-X plan: competitor option shows "Concorrentes fazem parte do plano Lucro" |

### 2.5 P21 / W12. Lendo os cardápios (the waiting screen)

The owner usually waits minutes to hours: one capture takes about 40 to 60 s, a failure retries after 10 and then 30 minutes, at most `m1.extract_max_running` (20) jobs run at once across every account, and the extractor may slow down. This screen says what is happening, honestly, and gives something to look at.

| | |
|---|---|
| **Steps** | 1 "Buscar a vizinhança" · 2 "Ler os cardápios" · 3 "Comparar os itens" · 4 "Calcular". Each shows done (with its result, "107 lojas encontradas, 31 escolhidas"), current (with live counts) or next ("Começa quando 90% dos cardápios estiverem lidos") |
| **Live counts** (step 2) | "27 de 31 cardápios lidos" over a segmented bar: lidos, lendo agora, na fila, tentando de novo (with the time, "nova tentativa às 14:40"), não deu para ler, fora das 30 mais relevantes (not in the denominator). "Sua loja: lida" always first; the target must be read before comparing |
| **Time** | A range, never a single minute: "cerca de 20 a 40 minutos". Method below. When the pace drops: "A leitura está mais lenta agora. Continuamos sozinhos, não precisa fazer nada." Never names blocks, captchas or iFood |
| **Useful while waiting** | Labeled "parcial, ainda sem comparação": the neighborhood found (count, distance band), the stores already read with item count each ("Concorrente A · 0,9 km · 64 itens"), and coverage of the owner's items by exact name in the stores read so far ("Seu Refrigerante cola 2 l já aparece em 12 lojas lidas"). No prices of others, no parity, no reading until step 4 is done |
| **Why it takes time** (copy for approval) | Under the steps, 2 lines with the run's real numbers: "Estamos lendo o cardápio completo de cada uma das 31 lojas perto de você, uma por uma. Até agora: 27 cardápios, 1.684 itens." Then a collapsed "Por que demora?" that expands to: "Comparamos cada item seu com os delas: mesmo produto, mesmo tamanho, mesmo sabor." / "O resultado só conta lojas que vendem o mesmo item de verdade." / "Você recebe uma análise feita para a sua loja, não uma média genérica." Numbers: stores = capture slots of the run (target excluded); menus and items = stores done and their non-removed items. Never claims about platform limits, overloading sites, blocks or how pages are fetched |
| **Leave** | "Pode fechar esta página. Avisamos por e-mail ou WhatsApp quando estiver pronto." with the person's channels from W08 (notice `xray_ready`, quiet hours D36) |
| **Partial and errors** | Pairing starts at `m1.pair_min_captures_pct` (90%) of slots finished: "Já dá para comparar com 28 de 31 lojas. As outras entram no próximo raio-X." Stores still running are named (`left_out_of_pairing`). All attempts of some stores failed: "Não deu para ler 2 lojas. O raio-X segue sem elas." Own store failed or has no menu: "Não conseguimos ler o cardápio da sua loja. Tentamos de novo às 15:10. Se continuar, a equipe MargoAI olha para você." (founder alert C21). Neighborhood failed: "Não conseguimos buscar a vizinhança agora. Tentamos de novo sozinhos." Reading off (`m1.extracao`): "A leitura automática está pausada. A equipe MargoAI já sabe." |
| **Actions** | "Tirar da comparação" on a read store (Dono; as C03 manual exclusion, audited). "Ver o último resultado" when a previous run exists. Nothing else: no retry button for owners |
| **Refresh** | Poll `GET /api/raio-x/[monitor]/progress` every 15 s while the tab is visible, every 60 s when hidden (Page Visibility), stop when the run reaches `ready` or a terminal error, then navigate to P22 (doubts) or P23. Same endpoint feeds the P19 row and C22 |

**Data sources (proposal).** One server function `public.xray_progress(p_xray)` (service role, called by the route after the permission check) returning: step; per store state from `xray_capture_states` extended with `running` (job claimed), `queued`, `retry_wait` (job `queued` with `not_before` in the future, plus that time), `done`, `failed`, `beyond_cap`; the pairing blocker (`xray_pair_blocker`); counts of the owner items with an exact normalized-name match in stores done; per store done its item count (`public_menu_item` not removed). Store names come from `public_store_snapshot`.

**Time range method.** Remaining work R = queued + running + retry_wait slots, minus what pairing does not need (only up to the 90% threshold for "comparar", all for "completo"). Pace P = captures finished for this X-ray per minute over the last 15 minutes; when fewer than 3 finished yet, P = min(running slots for the account's share, 20) / `m1.capture_typical_seconds` (new param, 50 s, measured median of `extract_run` durations, refreshed daily). Low = R / P. High = Low × 1.8 plus the latest `not_before` among retry_wait stores if it is later. Both rounded up to 5 minutes under an hour, to 15 minutes above; shown as "cerca de X a Y minutos" or "cerca de 1 a 2 horas". "Mais lenta" when no capture of this X-ray finished in 5 minutes while slots remain, or P fell below a third of the run's own median pace. Steps 3 and 4 add a fixed 2 to 5 minutes. When nothing is known (discovery still running): "Costuma levar de 30 minutos a 2 horas."

### 2.6 P22 / W13. Itens em dúvida (review by the owner)

| | |
|---|---|
| **Shows** | Header: "O sistema já confirmou 41 itens iguais sozinho. Ficou em dúvida em 9." Primary button, top and sticky at the bottom on phone: **"Confirmar todas as sugestões (9)"**. Each doubtful item: own item and price; question "É o mesmo produto que o seu?"; the candidates (item name, store name or "Loja vizinha N" per §6, price, size), with the suggestion pre-marked; one plain reason ("Não deu para ler o tamanho no nome", "Só 2 lojas vendem algo parecido", "Não sabemos o tipo deste item"). Per item: "Sim, é o mesmo" (marked candidates) and "Nenhum é o mesmo". Collapsed sections: "Itens só seus (6): ninguém por perto vende algo igual. Nada a fazer." and "Confirmados pelo sistema (41)" with "Não é o mesmo" per item for corrections |
| **Bulk** | Select items (checkbox, "Selecionar todos"); bar: "Confirmar sugestões dos selecionados", "Nenhum é o mesmo nos selecionados" |
| **Actions** | Each decision writes `xray_pair.accepted`, `by`, `audit_log`, and the monitoring's decision memory (§3.2). When the last doubt is answered: recalculates (`xray_calc`) and opens P23 with "Pronto. Seu raio-X foi atualizado." |
| **Rules** | M1-04 (doubts are its `revisar` items), M1-05 (an item a person reviewed gets parity from fewer stores, as for a founder today). The candidate pre-marked is the one M1-04 ranks first; for beverages, only same-attribute candidates are offered |
| **States** | No doubts: page says "Nada em dúvida. O sistema confirmou tudo sozinho." with "Ver resultado". Loading: skeleton. Run still reading: redirect to P21. Error saving: item stays unchanged, "Não salvou. Tente de novo." Concurrent edit (two people): the second sees "Outra pessoa já respondeu este item" with the answer |
| **Not blocking** | The result does not wait for the owner: P23 is computed without doubtful items (as `skipped`) and says so. Answers recalculate it |

### 2.7 P23 / W14. Resultado do raio-X

| | |
|---|---|
| **Shows** | Date and store; KPIs: "lojas comparadas", "itens comparados", "abaixo da vizinhança", "acima da vizinhança"; "Posição de preço: 4ª mais barata de 31 lojas" (M1-10); "Três preços que você pode subir hoje" (M1-09) with price strip (lowest, median, highest of the confirmed comparable items and own price); full table (item, seu preço, vizinhança, diferença, leitura), the M1-07 note "pode subir quando os vizinhos não estão em promoção"; "Não mexa sem saber o custo" list; Pareto sentence (M1-08); "Itens só seus" count; method note as C05 |
| **Banner** | When doubts remain: "Calculado sem 9 itens em dúvida. Responder agora" (P22). When some stores were not read: "Comparado com 28 de 31 lojas." |
| **Actions** | "Baixar PDF" (P01, same numbers); "Histórico" (P24); "Itens em dúvida" (P22); previous runs selector |
| **Competitor X-ray** | Same page about the competitor's store: "Como o Concorrente A se posiciona na vizinhança", plus a head-to-head block "Você e o Concorrente A" for items both sell (from the own store's latest run, where A is in the set) |
| **States** | First run not ready: redirect to P21. Run failed: "Este raio-X não terminou." with the last good one |

### 2.8 P24 / W15. Histórico

| | |
|---|---|
| **Shows** | Price position over time (M1-10 rank and index per run, a line chart with table view). Price per item over time: pick an item; lines "Você" and "Concorrente A" (any monitored competitor that sells it), with the neighborhood median as a dashed reference. Table of runs: date, lojas lidas, posição, itens comparados, "Ver" |
| **Rules** | `xray_store_rank`, `public_menu_item_snapshot`, `xray_item` per run of the monitoring; never rewritten |
| **States** | One run only: "O histórico aparece a partir do segundo raio-X, em 09/nov." Gaps (paused weeks) show as breaks, not interpolated |

---

## 3. Monitoring model

### 3.1 What a monitoring is

A monitoring (`xray_monitor`, new table) is an account's standing order: "read this store and its neighborhood every N days and give me a new X-ray". **Each run is a normal `xray` row**, with its snapshots (`public_store_snapshot`, `public_menu_item_snapshot`, `xray_store_rank`), so history is the list of runs of one monitoring and nothing already built changes meaning.

| Column | Meaning |
|---|---|
| `id`, `account_id`, `target_store_id` | the store watched |
| `target_kind` | `own` or `competitor` (same trigger logic as `xray.target_kind`) |
| `kitchen_id null` | competitor: "perto de qual cozinha" (Gerente scope); own: the store's kitchen |
| `every_days` | default `m1.extract_every_days` (7); options 7, 14, 28; at least the plan minimum |
| `radius_km`, `categories`, `rules` | copied into each run, as C02 sets on `xray` |
| `status` | `active`, `paused_by_person`, `paused_by_plan`, `target_gone`, `removed` |
| `next_run_at`, `last_xray_id` | scheduling |
| `created_by`, `paused_by`, `removed_by` + times | audit (plus `audit_log`) |

New on `xray`: `monitor_id null` (null for leads and one-off console X-rays).

### 3.2 How a run works, mapped to what exists

| Step | Today | With monitorings |
|---|---|---|
| Start | C02 creates `xray`, `extract_discover` | A daily cron (same as `extract_queue_due`) creates the next `xray` of each `active` monitoring with `next_run_at` due; first run right away from P20 |
| Neighborhood | discovery each X-ray | discovery on the first run, then every `m1.monitor_rediscover_days` (new param, 28); between, the run copies the previous run's `xray_store` set, ranks and capture slots (M1-11 unchanged) |
| Captures | stores of active X-rays every `extract_every_days` | "Active X-ray" becomes: the newest run of each `active` monitoring, plus today's definition for X-rays without a monitoring. A paused or removed monitoring stops captures. Captures stay per store, shared across all accounts: a store read today for another X-ray is not read again (`extract_capture_due`) |
| Pairing | C03 "Confirmar" by a founder | automatic once the 90% rule allows (04 §1); no person needed |
| Doubts | founder in C04 | owner in P22; decisions remembered per monitoring in `monitor_pair_decision` (`monitor_id`, own item external id, candidate store and item external ids, `accepted`, `decided_by`, `decided_at`) and applied on every later run, as M1-04 already does for a founder while the store stays in the set |
| Calculation | founder "Calcular raio-X" | automatic right after pairing, doubts as skipped; again after each batch of answers |
| PDF | C05 "Preparar entrega" | rendered on demand from P23 "Baixar PDF" |
| Status | `draft` to `delivered` | same enum; a monitored run ends at `ready`. `delivered` stays for leads (C06) |

Rule text changes: M1-04 and M1-05 say "a founder"; they become "a person with the review permission (05 §2.1), in the console or the portal". 04 §1 "Collection" gains the monitoring definition of active.

### 3.3 Plan limits

| Plan field | Raio-X (grátis) | Lucro (and trial) | Rede | Note |
|---|---|---|---|---|
| `own_monitors_max` (new) | 1 | every iFood store of kitchens in analysis | same | own stores are what they pay for |
| `competitor_monitors_max` (new) | 0 | 3 | 10 | active at once; paused ones do not count |
| `competitor_xrays_per_month` (exists, D55) | 0 | 3 | 10 | **meaning changes**: competitor monitorings started per São Paulo month (first runs only), so pausing, removing and adding cannot rotate through many stores. Later runs of a monitoring never count |
| `monitor_min_every_days` (new) | 90 (W05: "uma vez por trimestre") | 7 | 7 | shortest period allowed |

All edited in C15 like D40. Server functions check them; the UI only mirrors them.

**Capture cost.** One run reads the target plus up to `m1.extract_max_captures_per_xray` (30) stores, plus a discovery every 28 days. Weekly: about 4.3 runs, so at most about 135 captures per monitoring per month. Real cost is lower because captures are per store and shared: an owner's own store and a competitor 1 km away share most neighbors, and a store already read within `extract_every_days` is not read again. Worst case for a Lucro account with 2 own stores and 3 competitors in distinct neighborhoods: 5 × 135 ≈ 675 captures a month; typical (same neighborhood) about 200 to 300. The per-capture price of the external service is Marlon's number (open question).

**Downgrade and upgrade.**

| Event | What happens |
|---|---|
| Lucro or trial ends to Raio-X | Competitor monitorings become `paused_by_plan`. Own monitorings: the one the Dono picks stays (default: the oldest), set to 90 days; the rest `paused_by_plan`. History stays visible to everyone who could see it. P19 says "Pausado pelo plano. Volta quando você assinar o Lucro." |
| Rede to Lucro | Competitors beyond 3 become `paused_by_plan`, newest first; the Dono can swap which stay |
| Upgrade | `paused_by_plan` monitorings resume automatically, within the new limits; `paused_by_person` stay paused |
| Account cancelled (D61) | as downgrade to Raio-X; deletion rules unchanged |
| `m1.concorrente` turned off for an account | competitor monitorings `paused_by_plan` |

---

## 4. Console (founders)

| Screen | Change |
|---|---|
| C22 Acompanhamentos (new) | All monitorings across accounts: account, store, kind, period, status, current step and counts (same progress endpoint), pending doubts, last error, time in current step. Filters: status, "parado há mais de 2 h". Row opens the run in C03 to C05 |
| C02 | Gains "Para a conta" (closes the build-review gap on `?conta=`) and "Acompanhar toda semana" (creates a monitoring for the account). Without an account (lead) it stays a one-off X-ray, delivered by C06 |
| C03 | For a monitored run: banner "Raio-X acompanhado pela conta Grupo Exemplo"; same waiting data as P21 with the technical layer kept (job ids, attempts, `not_before`, errors) |
| C04 | Shows who decided each pair (owner name or founder). Founder can still decide, labeled "suporte" in `audit_log`; the owner sees "respondido pela equipe MargoAI" |
| C05, C06 | C05 unchanged. C06 only for leads |
| C21 | New alerts: own store not readable after all attempts (medio); monitoring stuck in a step over 2 h (medio); `m1.extracao` off while monitorings are active (urgente in production) |

What a founder still does: support and unblock. Retry or end a stuck capture (02 §4.5), re-run discovery, fix a store's category or chain flag, include a store by hand, answer doubts on request, pause a monitoring for an account (audited), and run X-rays for leads.

---

## 5. Notices (proposals)

| Code | Notice (pt-BR) | Who | When | E-mail | WhatsApp |
|---|---|---|---|---|---|
| `xray_ready` | Seu raio-X está pronto | the person who started it, plus Dono | a run reaches `ready`; for weekly runs only when something changed (a new "pode subir", a position change of 2 or more, or a doubt) | on | on |
| `xray_needs_answer` | Itens esperando sua resposta | Dono (and Gerente if approved) | doubts exist 24 h after `ready`; at most once per run | on | off |
| `competitor_price_change` | Um concorrente mudou o preço | Dono, Financeiro | a monitored competitor's item that the owner also sells changed price by at least `m1.notice_price_change_pct` (new param, 5%) between runs | on | off |
| `monitor_paused` | Acompanhamento pausado | Dono | paused by plan, store gone, or own store unreadable after all attempts | on | off |

Examples (fictitious): "Seu raio-X da Lanchonete Exemplo Centro está pronto: 3 preços podem subir." "O Concorrente A subiu o X-Bacon de R$ 32,90 para R$ 34,90." Quiet hours D36 apply (WhatsApp held to 8h); WhatsApp is `whatsapp_manual` until the Business Platform. They join the W08 table (it then lists 14 notices). `weekly_summary` gains one line for M1 when the flag is on.

---

## 6. Competitor data shown to owners (for the legal consult D01b)

| Data | Where | Proposal | Fallback if D01b says no |
|---|---|---|---|
| Name of a competitor the owner chose to monitor | P19, P23, P24 | shown (the owner typed its link) | the owner's own label |
| Names of other neighborhood stores | P21 (stores read), P22 (candidate's store), P23 ranking | shown | "Loja vizinha 07" |
| Their item names and prices | P22 candidates, P23 strip (lowest, median, highest), P24 competitor line | shown, current snapshot and history | aggregated only (median, range, count); no single store's price |
| Price history of a named competitor and the price-change notice | P24, `competitor_price_change` | shown | off |
| Distance | P21, P23 | rounded to 0,1 km | band ("até 1 km") |
| Rating value, rating count, street address | nowhere | never shown (D47c) | |
| M1-10 position of other stores | P23 | only the owner's and monitored competitors' positions, the rest as count | |

Legal points to put to D01b: showing a named third party's prices to a business that competes with it; keeping and showing their price history; notifying changes; whether "Loja vizinha N" is required for unmonitored stores.

---

## 7. Open questions for Marlon

1. Gerente de cozinha answers doubts for own kitchens (proposed yes)?
2. Limits: concurrent competitor monitorings 0/3/10 plus starts per month 0/3/10 (the existing field, new meaning). Agreed, or one limit only?
3. Raio-X free plan: 1 own store every 90 days, as W05 says. Or monthly?
4. Competitor X-ray doubts: does the owner answer them (the competitor's items against its neighbors) or does the system leave doubtful competitor items out with no question? Proposed: left out, with "Revisar mesmo assim" optional.
5. `m1.portal` off until D01b, or released for the test case first?
6. Per-capture price of the external service, to fix the monthly capture budget per plan.
7. Named neighborhood stores (§6) before D01b answers, or "Loja vizinha N" until then?
8. Who is "the person who started it" for `xray_ready` when a weekly run starts by itself: Dono plus the monitoring's creator?
9. Approve the "Por que demora?" copy in §2.5 (every line is true of the process; no claim about platforms).
10. Codes: P19 to P24 / W10 to W15 need drawings in `design/` (Claude cannot add them); until drawn, `check_screens.py` has nothing to check.

## 8. Not decided here

- Head-to-head on P23 for competitor monitorings uses the own store's latest run; if the competitor is outside every own store's set, the block is hidden. Fine for V1?
- Whether "Tirar da comparação" by an owner should persist to later runs of the monitoring (proposed: yes, like a founder's manual exclusion).
- The chart palette: `tokens.css` has no categorical chart colors; the prototype uses two validated series colors as a stand-in.

---

## 9. Proposed decision row (format of `docs/decisions-amendments-draft.md`)

| ID | Amends | Text |
|---|---|---|
| D65 | 01 §1, 04 M1-04, M1-05, §1 Collection, §5, §6, §9, 05 C02 to C06, D55 | Marlon decided on 07/nov: the price X-ray moves to the owner portal (P19 to P24, W10 to W15). The owner starts and follows **monitorings** of own stores and competitors: each is a standing order whose runs are ordinary X-rays with their snapshots, weekly by default (`m1.extract_every_days`), with pause, resume and remove. Pairing and calculation run by themselves; the owner answers only doubtful items ("é o mesmo produto que o seu?", suggestion pre-marked, "Confirmar todas as sugestões"), decisions are remembered per monitoring and audited, and Dono decides (Gerente for own kitchens, if approved). The waiting screen shows steps, live counts and a time range from the measured pace. Limits per plan: own stores 1 every 90 days / all in analysis / all; active competitor monitorings 0/3/10; `competitor_xrays_per_month` now counts competitor monitorings started. A downgrade pauses, never deletes. The console keeps every screen for support and leads (new C22). New flag `m1.portal`, off until the legal consult (D01b) clears the competitor data owners see |

---

## 10. Provisional choices (built on `nov/monitoring`, for Marlon's review)

Marlon has not answered §7. The backend uses each proposed default, marked PROVISIONAL in the code, and keeps each one in a param, a flag or reference data, so changing it is data, not code. Migrations `20261230000001_m1_monitor.sql` and `20261230000002_m1_positions.sql`.

| Question | Choice built | Where to change it |
|---|---|---|
| Q1 Gerente answers doubts | Yes, for monitorings of their kitchens (`xray_monitor.kitchen_id`); Financeiro only sees | `rule_param` `m1.portal_gerente_answers` (1 or 0) |
| Q2 Limits | Active competitor monitorings limited by `plan.competitor_xrays_per_month` (0/3/10); starts per São Paulo month counted separately against the same field. Console one-off competitor X-rays keep their own count (monitored runs no longer count there) | `plan.competitor_xrays_per_month` (C15); `m1.monitor_count_month_starts` (1 counts starts, 0 only active) |
| Q3 Free plan | One own store active, a run at most every 90 days; Lucro and Rede 7 days, no own-store limit. The owner's period is kept; a run waits the longer of it and the plan minimum, so a plan change rewrites nothing | `m1.monitor_own_max_<plan>` (no row: no limit), `m1.monitor_min_every_days_<plan>` |
| Q4 Competitor doubts | Not asked: listed with `asked: false` ("Revisar mesmo assim"); the result is computed without them like any doubt | `m1.portal_competitor_doubts_asked` (0 or 1) |
| Q5 `m1.portal` | On in sandbox, off in production, every plan | C20 |
| Q7 Neighborhood store names | Shown by name; 0 shows "Loja vizinha NN" by its M1-11 rank in the run | `m1.portal_show_store_names` |
| Q8 Who gets `xray_ready` / `xray_needs_answer` | Dono and Gerente (their kitchens, filtered by the sender). Rows and preferences exist; e-mails, W08 rows and sending come with the screens | `notice_type.audience_roles` |
| Q9 "Por que demora?" | Not built (copy is the screens' part); the loader returns the real numbers it needs (`stores_chosen`, `items_read`) | |
| Suggestion pre-marked (§2.6) | The candidate M1-04 ranks first (highest similarity), one per doubt | `app.monitor_suggestion` (one SQL function) |
| Rediscovery | Every 28 days, or when radius, categories or rules change; between, a run copies the previous store set with its ranks and capture places | `m1.monitor_rediscover_days` |
| Time range (§2.5) | Pace of the last 15 minutes; 50 s per capture with fewer than 3 done; "mais lenta" after 5 minutes without a finished capture | `m1.portal_pace_window_minutes`, `m1.capture_typical_seconds`, `m1.portal_slow_minutes` |
| Downgrade and upgrade | A plan change (subscription or account) pauses the newest beyond the limit as `paused_by_plan` and resumes the oldest within it, audited as the system; `paused_by_person` stays; the daily cron applies it again | triggers on `subscription` and `account` |
| A run that does not finish | The next one waits a day while the newest is still collecting or pairing | `monitor_queue_due` |
| Score de preço (M1-12, proposed in spec 04) | v2 "share of the neighborhood price the store charges", with "diferença de preço por venda" and "risco" beside it; category score from 5 items; positions per category and per item | `m1.score_min_items`; formula in `app.score_captured_m1_12` with `app.score_version_m1_12` |

Not built here: Q6 (capture budget), Q10 (drawings), the head-to-head block of §2.7, "Tirar da comparação" by an owner (§8), C22 and the C21 alerts of §4, the print route of the result and its token, `target_gone`.
