# Copy review: product text written without a drawing

Every piece of Brazilian Portuguese product text in the code that does not appear in any `design/*.dc.html` drawing. Collected from the web app, the e-mails and notices, the extension, the PDF and export workers, and the flag descriptions in the migrations. Seed data (store, item and people names) and synthetic test files are left out.

**How to mark it:** read each table top to bottom. If the text is fine, write `OK` in **Nova versão**. If not, write the new text there, verbatim, as it should appear. Leave it empty if you have not looked yet.

Notes:

- `{...}` is filled at run time (a value, date, name, count). Alternatives are shown as `{a | b}`. Keep the braces in the new version when the value stays.
- `↵` is a line break in a plain-text e-mail or file.
- **Onde** is `path:line` from the repo root; a string used in several places lists each place.
- A string counts as drawn when the same words appear in any drawing, even in another screen; those are not listed. See "Matched in another drawing" at the end for the few that may need a second look.
- Accessible names (`aria-label`) and plain 404 bodies are included: a screen reader or a browser shows them.

## Em dash check

No product string in the code contains an em dash (—). Checked every Portuguese string collected, drawn or not.

## C00 Login do console

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Mandamos um código de 6 números para o seu e-mail. Ele vale por 10 minutos. | `apps/web/lib/auth/login.ts:8` | After asking for a login code (C00 and P15/W06) | |
| Espere um minuto para pedir outro código. | `apps/web/lib/auth/login.ts:10` | Asking for a second code within one minute | |
| Muitas tentativas. Tente de novo em 15 minutos. | `apps/web/lib/auth/login.ts:11` | Too many wrong codes; locked for 15 minutes | |
| Código errado. Confira e tente de novo. | `apps/web/lib/auth/login.ts:12` | Wrong code typed | |
| Código vencido. Peça um novo. | `apps/web/lib/auth/login.ts:13` | Code older than 10 minutes | |

## C01 Clientes

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Revisar diferenças | `apps/web/lib/console/clients.ts:74` | "Próximo passo" column when the client has differences to review | |

## C02 Novo raio-X

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Para a conta {nome} ({conta}) | `apps/web/app/console/(app)/raio-x/novo/NewXrayForm.tsx:35` | C02 opened with ?conta= (competitor X-ray): which account it is for | |
| Cole o link de uma loja do iFood: ele termina com o código da loja. | `apps/web/lib/xray/labels.ts:40` | Pasted link is not an iFood store link | |
| Escolha o raio e as categorias. | `apps/web/lib/xray/labels.ts:41` | Form sent without radius or category | |
| Loja ainda não coletada: nome, bairro e categoria aparecem depois da busca. | `apps/web/lib/xray/labels.ts:42` | Store preview before the first collection | |
| Conta não encontrada. | `apps/web/lib/xray/labels.ts:57` | Account code in the URL does not exist | |
| Raio-X de concorrente fora do plano desta conta. | `apps/web/lib/xray/labels.ts:63` | Competitor X-ray when the plan allows 0 (or m1.concorrente off) | |
| Limite do plano atingido: {limite} raio-X de concorrente por mês. O próximo fica para o mês que vem. | `apps/web/lib/xray/labels.ts:64` | Competitor X-ray over the monthly limit | |

## C03 Vizinhança

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Lojas da vizinhança | `apps/web/app/console/(app)/raio-x/[id]/vizinhanca/NeighborhoodView.tsx:88` | Accessible name of the store list | |
| Na fila: a busca começa quando o coletor estiver livre. | `apps/web/lib/xray/labels.ts:43` | Collection job queued | |
| Buscando as lojas da vizinhança. | `apps/web/lib/xray/labels.ts:44` | Collection running | |
| Coleta parada: o raio-X está desligado para esta conta. | `apps/web/lib/xray/labels.ts:70` | Collection stopped: X-ray flag off for the account | |
| Coleta parada: a extração está desligada para esta conta. | `apps/web/lib/xray/labels.ts:71` | Collection stopped: extraction flag off for the account | |
| Coleta parada: o canal recusou o acesso. | `apps/web/lib/xray/labels.ts:74` | Collection stopped: extractor reports a block | |
| Coleta parada: a loja não foi encontrada nesse link. | `apps/web/lib/xray/labels.ts:76` | Collection stopped: store not found | |
| Coleta parada: a página veio em um formato que não sabemos ler. | `apps/web/lib/xray/labels.ts:78` | Collection stopped: extractor could not parse the page | |
| Coleta parada: a leitura demorou demais. | `apps/web/lib/xray/labels.ts:80` | Collection stopped: extractor timed out | |
| Coleta parada: a conexão com o canal falhou. | `apps/web/lib/xray/labels.ts` (`collectStopReason`) | Collection stopped: the extractor's connection failed on every attempt (`network`) | |
| Coleta parada: a leitura travou e as tentativas acabaram. | `apps/web/lib/xray/labels.ts` (`collectStopReason`) | Collection stopped: the job got stuck and had no attempts left | |
| Coleta parada: erro ao ler as páginas públicas. | `apps/web/lib/xray/labels.ts:84` | Collection stopped: any other read error | |
| Cardápios: {N} {pronto \| prontos}, {N} faltando, {N} com falha{, N sem captura pelo limite}. | `apps/web/lib/xray/labels.ts` (`captureProgressLabel`) | C03: the captures of this X-ray's stores; the limit part only when stores are past `m1.extract_max_captures_per_xray` | |
| prioridade {N}, nota {N} | `apps/web/lib/xray/labels.ts` (`captureRankLabel`) | C03 store list, after the distance: the M1-11 capture ranking; only for stores that have one | |
| Confirmar libera quando a vizinhança atualizar. | `apps/web/lib/xray/labels.ts` | C03: the neighborhood job is active | |
| Confirmar libera quando o cardápio da loja do raio-X estiver pronto. | `apps/web/lib/xray/labels.ts` | C03: the target has no finished capture or no menu | |
| Confirmar libera com {necessários} de {total} cardápios terminados: faltam {n}. | `apps/web/lib/xray/labels.ts` | C03: too few captures finished (M1-04) | |
| Confirmar agora deixa de fora as lojas que faltam. Quando terminarem, só os dados delas mudam. | `apps/web/lib/xray/labels.ts` | C03: enough captures finished, some still running | |
| Fora do pareamento, a captura não tinha terminado: {lojas}. | `apps/web/lib/xray/labels.ts` | C03 after pairing: stores left out | |
| no conjunto, fora do pareamento | `apps/web/lib/xray/view.ts` | C03 store row: left out of the last pairing | |
| Atualizando a vizinhança com os cardápios capturados. | `apps/web/lib/xray/labels.ts` (`neighborhoodPending`) | C03: the neighborhood job runs again after the last capture | |
| A captura do cardápio de {loja} falhou. | `apps/web/lib/xray/labels.ts` (`targetCaptureFailed`) | C03: the capture of the X-ray's own target failed | |
| no conjunto, captura falhou | `apps/web/lib/xray/view.ts` (`storeState`) | C03 store list: a store in the set whose capture failed | |
| no conjunto, nova tentativa às {16:40} | `apps/web/lib/xray/view.ts` (`storeState`), `apps/web/lib/xray/labels.ts` (`retryLabel`) | C03 store list: a store in the set whose capture waits to retry; the time in São Paulo | |
| no conjunto, fora do pareamento, nova tentativa às {16:40} | `apps/web/lib/xray/view.ts` (`storeState`) | C03 store list: a store left out of the last pairing whose capture still waits to retry | |
| Cardápio de {loja}: nova tentativa às {16:40}. | `apps/web/lib/xray/labels.ts` (`targetCaptureRetry`) | C03: the capture of the X-ray's own target waits to retry | |
| no conjunto, sem captura pelo limite | `apps/web/lib/xray/view.ts` (`storeState`) | C03 store list: a store in the set past the capture limit | |
| regra: não entrega no bairro | `workers/collector/src/margo_collector/rules.py:210` | Exclusion reason in the store list (M1-02, store does not deliver to the area) | |
| regra: outra categoria | `workers/collector/src/margo_collector/rules.py:212` | Exclusion reason in the store list (M1-02, no search term or taxonomy in common) | |

## C04 Pareamento

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| revisar: tipo ilegível | `workers/collector/src/margo_collector/attributes.py` | A beverage whose type the rules cannot read (M1-04) | |
| revisar: tamanho ilegível | `workers/collector/src/margo_collector/attributes.py` | A beverage with no size in its name (M1-04) | |
| revisar: marca ilegível | `workers/collector/src/margo_collector/attributes.py` | A beverage with no brand and no identical item (M1-04) | |
| revisar: sabor ilegível | `workers/collector/src/margo_collector/attributes.py` | A beverage with no flavor and no identical item (M1-04) | |
| revisar: nenhuma loja com os mesmos atributos | `workers/collector/src/margo_collector/attributes.py` | A beverage no store sells with the same attributes (M1-04) | |
| revisar: nenhum item parecido | `workers/collector/src/margo_collector/attributes.py` | An item no store sells under a close name (M1-04) | |
| revisar: categoria não identificada | `workers/collector/src/margo_collector/attributes.py` | An item no source places in a category (M1-04) | |
| exclusivo, sem comparação | `apps/web/lib/xray/labels.ts:30`, `workers/collector/src/margo_collector/food.py` (`EXCLUSIVE_NOTE`) | A non-beverage item no store of the set sells with the same attributes (M1-04 Stage 2): not a problem, outside parity, loss and the Pareto; a founder can still pair it | |
| {pareado \| normalizado}, tamanho presumido {n} ml | `apps/web/lib/xray/labels.ts`, `workers/collector/src/margo_collector/rules.py` (`presumed_note`) | A beverage pair that rests on a default size (water 500 ml, a "lata" 350 ml, or a brand and container's dominant stated size) (M1-04) | |
| revisar: proteína ilegível | `workers/collector/src/margo_collector/food.py` | A lanche whose protein neither the rules nor the AI can read (M1-04 Stage 2) | |
| revisar: tipo ilegível | `workers/collector/src/margo_collector/food.py` | A porção whose type and protein neither the rules nor the AI can read (M1-04 Stage 2); same words as the beverage note | |
| Pares de {nome} | `apps/web/app/console/(app)/raio-x/[id]/pareamento/page.tsx:26` | Accessible name of an item's pairs panel | |
| O pareamento não rodou: ainda havia cardápios na fila. Confirme o conjunto de novo na vizinhança quando terminarem. | `apps/web/lib/xray/labels.ts` (`pairWaitedForLoad`) | C04: an `xray_pair` job arrived while captures ran | |
| Pareando os itens. Atualize a página em instantes. | `apps/web/lib/xray/labels.ts:45` | Pairing job running | |
| revisado | `apps/web/lib/xray/labels.ts:50` | Item status after a person reviewed its pairs | |
| Salvar pares | `apps/web/lib/xray/labels.ts:52` | Button under an item's pairs | |
| Deixar fora da conta | `apps/web/lib/xray/labels.ts:53` | Button: leave the item out of the X-ray | |
| Voltar para a conta | `apps/web/lib/xray/labels.ts:54` | Button: put a left-out item back | |

## C05 Raio-X de preço

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Posição por preço: 1 é a loja mais barata entre as comparadas. | `apps/web/app/console/(app)/raio-x/[id]/page.tsx:114` | Note under the comparison table | |
| Coleta | `apps/web/app/console/(app)/raio-x/[id]/page.tsx:118` | Table header: collection date | |
| Posição por preço | `apps/web/app/console/(app)/raio-x/[id]/page.tsx:128` | Table header | |
| Calculando o raio-X. Atualize a página em instantes. | `apps/web/lib/xray/labels.ts:46` | Calculation job running | |
| Calcule o raio-X no passo 3. | `apps/web/lib/xray/labels.ts:49` | C05 opened before step 3 ran | |
| A tarefa falhou. Peça para rodar de novo. | `apps/web/lib/xray/labels.ts:56` | Any X-ray job failed | |
| loja própria | `apps/web/lib/xray/labels.ts:89` | Small label next to the store: own store (vs competitor) | |
| sem promoção: {paridade}, {diferença} | `apps/web/lib/xray/labels.ts:63` | Under "Paridade": parity and gap at full prices, when the parity or the gap differs from the current one (M1-05) | |
| Sem paridade, poucas lojas vendem o mesmo item: {itens}. | `apps/web/lib/xray/labels.ts:78` | Under the C05 table: paired items with too few stores for a parity (M1-05) | |
| Exclusivos, sem comparação, nenhuma loja do raio-X vende o mesmo item: {itens}. | `apps/web/lib/xray/labels.ts:84` | Under the C05 table: exclusive items with no parity (M1-04 Stage 2) | |
| pode subir quando os vizinhos não estão em promoção | `apps/web/lib/xray/labels.ts:59` | Under "Leitura" of a `na_media` item with room at full prices (M1-07) | |

## C06 Entrega ao dono

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| PDF · A4 · {n} páginas | `apps/web/lib/xray/labels.ts:66` | C06 file thumbnail: the rendered file's real page count (drawn: "2 páginas", which the seed still shows). Before there is a file: "PDF · A4" | |
| PDF em preparação. Atualize a página em instantes. | `apps/web/lib/xray/labels.ts:47` | PDF job running | |
| Prepare a entrega no passo 4 para gerar o PDF. | `apps/web/lib/xray/labels.ts:48` | PDF link before the delivery is prepared | |
| Horas: use números como 0,5. | `apps/web/lib/xray/labels.ts:55` | Hours field not a number | |

## C07 Conectar e importar

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Para quem | `apps/web/app/console/(app)/contas/[code]/extensao/PairingCodeForm.tsx:15` | Console extension page: person select label | |
| Gerar código | `apps/web/app/console/(app)/contas/[code]/extensao/PairingCodeForm.tsx:25` | Console extension page: button | |
| Código de {nome}, vale até {hora} e uma vez só. A pessoa digita na extensão, no computador dela. | `apps/web/app/console/(app)/contas/[code]/extensao/PairingCodeForm.tsx:33` | After generating a pairing code | |
| Escolha uma pessoa desta conta. | `apps/web/app/console/(app)/contas/[code]/extensao/actions.ts:22` | Generate code without a valid person | |
| P04 · Módulo 2 · {nome} ({conta}) | `apps/web/app/console/(app)/contas/[code]/extensao/page.tsx:33` | Console extension page: eyebrow and lead | |
| Cada pessoa pareia a extensão no próprio computador com um código. A extensão só manda o arquivo que a pessoa escolhe, na página do Portal do Parceiro que ela abriu. | `apps/web/app/console/(app)/contas/[code]/extensao/page.tsx:33` | Console extension page: eyebrow and lead | |
| Último uso | `apps/web/app/console/(app)/contas/[code]/extensao/page.tsx:43` | Console extension page: table header | |
| Ninguém pareou a extensão ainda. | `apps/web/app/console/(app)/contas/[code]/extensao/page.tsx:51` | Console extension page: nobody paired yet | |
| código vale até {data} | `apps/web/app/console/(app)/contas/[code]/extensao/page.tsx:64` | Console extension page: pending code pill | |
| Código para parear | `apps/web/app/console/(app)/contas/[code]/extensao/page.tsx:85` | Console extension page: form title | |
| Voltar para Conectar e importar | `apps/web/app/console/(app)/contas/[code]/extensao/page.tsx:90` | Console extension page: back link | |
| Importação deste canal desligada para esta conta. | `apps/web/app/console/(app)/contas/[code]/importacoes/actions.ts:22` | Upload when the channel's import flag is off | |
| Escolha um arquivo. | `apps/web/app/console/(app)/contas/[code]/importacoes/actions.ts:23` | Upload without a file | |
| iFood (arquivo do portal) | `apps/web/app/console/(app)/contas/[code]/importacoes/page.tsx:49` | Channel select option when m2.arquivo_ifood is on | |
| Canal do arquivo | `apps/web/app/console/(app)/contas/[code]/importacoes/page.tsx:121` | Accessible name of the channel select | |
| sem detalhes | `apps/web/app/console/(app)/contas/[code]/importacoes/page.tsx:198` | Failed import without a log | |
| anteriores | `apps/web/app/console/(app)/contas/[code]/importacoes/page.tsx:211` | Import list pagination | |
| mais antigas | `apps/web/app/console/(app)/contas/[code]/importacoes/page.tsx:215` | Import list pagination | |
| repasse não bate | `apps/web/lib/m2/imports.ts:78` | Failure reason: payout total does not match | |
| loja desconhecida | `apps/web/lib/m2/imports.ts:79` | Failure reason: store not in the account | |
| sem autorização do dono | `apps/web/lib/m2/imports.ts:80` | Failure reason: CNPJ without owner authorization | |
| arquivo ilegível | `apps/web/lib/m2/imports.ts:81` | Failure reason: file unreadable | |
| valor ilegível | `apps/web/lib/m2/imports.ts:82` | Failure reason: a value unreadable | |
| arquivo sumiu | `apps/web/lib/m2/imports.ts:83` | Failure reason: stored file missing | |
| canal errado | `apps/web/lib/m2/imports.ts:84` | Failure reason: file from another channel | |
| {n} linhas canônicas novas | `apps/web/lib/m2/imports.ts:119` | Import result detail | |
| canal sem importação por arquivo | `apps/web/lib/m2/imports.ts:231` | Upload refused: channel has no file import | |
| Sem autorização do dono para este CNPJ. A importação espera a autorização assinada. | `apps/web/lib/m2/imports.ts:252` | Upload refused: CNPJ without owner authorization | |
| Arquivo precisa ser .csv ou .xlsx. | `apps/web/lib/m2/imports.ts:255` | Upload refused: wrong file type | |
| Só um arquivo pode rodar de novo. | `apps/web/lib/m2/imports.ts:281` | "Rodar de novo" on an import without a file | |

## C08 Fechamento

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Nenhuma importação neste mês. | `apps/web/app/console/(app)/contas/[code]/fechamento/[yyyy-mm]/page.tsx:82` | Month with no import | |
| só no console | `apps/web/lib/m2/close.ts:87` | Difference status when confidence is "duvidosa" (owner does not see it) | |
| 1 diferença no repasse | `apps/web/lib/m2/close.ts:132` | Banner singular (drawn plural: "6 diferenças no repasse") | |

## C09 Diferenças no repasse

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| não encontrado | `apps/web/app/console/(app)/contas/[code]/diferencas/[id]/pedidos/route.ts:12`<br>`apps/web/app/console/(app)/contas/[code]/diferencas/[id]/pedidos/route.ts:16` | Orders download for an unknown difference (plain 404 text) | |
| Fechamento gerado: o PDF está na fila. O dono foi avisado. | `apps/web/app/console/(app)/contas/[code]/fechamento/[yyyy-mm]/diferencas/page.tsx:61` | After "Gerar fechamento" (also on C13); ": o PDF está na fila" and "O dono foi avisado." are optional parts | |
| Baixar os pedidos | `apps/web/app/console/(app)/contas/[code]/fechamento/[yyyy-mm]/diferencas/page.tsx:102` | Link to the orders sheet of a difference | |
| Data do pedido | `apps/web/lib/m2/evidence.ts:17` | Column header of the orders sheet (xlsx) | |
| Pedido entregue sem repasse depois do prazo | `workers/import/src/margo_import/rules.py:379` | DIF-04 description (certa: after the deadline) | |
| Pedido sem repasse | `workers/import/src/margo_import/rules.py:380` | DIF-04 short name | |
| Reembolso cobrado da loja sem reclamação registrada | `workers/import/src/margo_import/rules.py:419` | DIF-05 description | |
| Reembolso sem reclamação | `workers/import/src/margo_import/rules.py:420` | DIF-05 short name | |

## C10 Notas de compra

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Escolha o .zip do contador. | `apps/web/app/console/(app)/contas/[code]/notas/actions.ts:31` | Upload without a .zip | |
| Data da nota | `apps/web/app/console/(app)/contas/[code]/notas/page.tsx:107` | Manual receipt form: field | |
| Descrição do item | `apps/web/app/console/(app)/contas/[code]/notas/page.tsx:108` | Manual receipt form: field and placeholder | |
| descrição como na nota | `apps/web/app/console/(app)/contas/[code]/notas/page.tsx:108` | Manual receipt form: field and placeholder | |
| Valor do item | `apps/web/app/console/(app)/contas/[code]/notas/page.tsx:111` | Manual receipt form: field and placeholder | |
| valor do item, R$ | `apps/web/app/console/(app)/contas/[code]/notas/page.tsx:111` | Manual receipt form: field and placeholder | |
| Adicionar item | `apps/web/app/console/(app)/contas/[code]/notas/page.tsx:113` | Manual receipt form: button | |
| Esta nota já está salva. | `apps/web/lib/m3/notas.ts:18` | Same receipt key typed twice | |
| o arquivo não é um .zip | `apps/web/lib/m3/notas.ts:35` | Import failure reason: not a .zip | |
| falta a autorização do dono para notas | `apps/web/lib/m3/notas.ts:36` | Import failure reason: no owner authorization for invoices | |
| importações pausadas para esta conta | `apps/web/lib/m3/notas.ts:37` | Import failure reason: imports paused (no plan) | |
| arquivo não encontrado | `apps/web/lib/m3/notas.ts:38` | Import failure reason: stored file missing | |
| Nenhum .zip importado ainda. | `apps/web/lib/m3/notas.ts:44` | Import box before any .zip | |
| Importando o .zip... | `apps/web/lib/m3/notas.ts:45` | Import box while the .zip is processed | |
| A importação falhou: {motivo}. | `apps/web/lib/m3/notas.ts:48` | Import box after a failure | |
| Nenhum insumo faltando. | `apps/web/lib/m3/notas.ts:114` | Missing-ingredients line (drawn: "Faltam 4 insumos.") | |
| Falta 1 insumo. | `apps/web/lib/m3/notas.ts:114` | Missing-ingredients line (drawn: "Faltam 4 insumos.") | |
| Sem autorização do dono para notas deste CNPJ. A importação espera a autorização assinada. | `apps/web/lib/m3/notas.ts:125` | Key or .zip refused: CNPJ without owner authorization | |
| O arquivo precisa ser um .zip. | `apps/web/lib/m3/notas.ts:131` | Upload of a file that is not .zip | |
| Chave inválida: confira os 44 dígitos ou o link do QR code. | `apps/web/lib/m3/notas.ts:151` | Receipt key with a wrong length or bad QR link | |
| Esta conta tem mais de uma empresa: importe o .zip do contador. | `apps/web/lib/m3/notas.ts:154` | Key typed for an account with several companies | |
| Nota não encontrada. | `apps/web/lib/m3/notas.ts:230` | Adding a line to a receipt that is gone | |
| Preencha data, descrição, unidade, quantidade e valor do item. | `apps/web/lib/m3/notas.ts:236` | Manual line with an empty field | |

## C11 De-para de insumos

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Unidades do insumo por unidade da nota | `apps/web/app/console/(app)/contas/[code]/de-para/page.tsx:33`<br>`apps/web/app/console/(app)/contas/[code]/de-para/page.tsx:61` | Conversion field (invoice unit to ingredient unit) | |
| Nome do insumo novo | `apps/web/app/console/(app)/contas/[code]/de-para/page.tsx:52` | New-ingredient field: label and placeholder | |
| nome do insumo novo | `apps/web/app/console/(app)/contas/[code]/de-para/page.tsx:52` | New-ingredient field: label and placeholder | |
| g, ml ou un por {unidade} | `apps/web/app/console/(app)/contas/[code]/de-para/page.tsx:61` | Conversion field placeholder | |
| Salvar troca | `apps/web/app/console/(app)/contas/[code]/de-para/page.tsx:63` | Button: save the chosen ingredient | |
| Recusar sugestão | `apps/web/app/console/(app)/contas/[code]/de-para/page.tsx:70` | Button: refuse the suggestion | |
| Regras gerais em revisão | `apps/web/app/console/(app)/contas/[code]/de-para/page.tsx:160` | Card of general rules in dispute | |
| Em alguma conta, uma pessoa escolheu outro insumo para uma nota que a regra geral casava. Até um fundador revisar, a regra só sugere e não confirma sozinha. | `apps/web/app/console/(app)/contas/[code]/de-para/page.tsx:163` | Lead of that card | |
| Insumo da regra | `apps/web/app/console/(app)/contas/[code]/de-para/page.tsx:170` | Table header in that card | |
| Escolhido na conta | `apps/web/app/console/(app)/contas/[code]/de-para/page.tsx:171` | Table header in that card | |
| Revisada | `apps/web/app/console/(app)/contas/[code]/de-para/page.tsx:186` | Button: founder marks the rule reviewed | |
| outro insumo | `apps/web/lib/m3/depara.ts:203` | Fallback when the chosen ingredient has no name | |
| Informe quantas unidades do insumo vêm em uma unidade da nota. | `apps/web/lib/m3/depara.ts:249`<br>`apps/web/lib/m3/depara.ts:298` | Saving without the conversion factor | |
| Dê nome e categoria ao insumo novo. | `apps/web/lib/m3/depara.ts:291` | New ingredient without name or category | |
| Já existe um insumo com esse nome no catálogo. | `apps/web/lib/m3/depara.ts:293` | New ingredient name already in the catalog | |
| Essa regra já foi revisada. | `apps/web/lib/m3/depara.ts:326` | Marking a rule reviewed twice | |
| sugestão da regra geral | `workers/match/src/margo_match/matching.py:133` | "Como casou" note: suggestion from a general rule | |
| conflito entre regras, revisar | `workers/match/src/margo_match/matching.py:134` | "Como casou" note: account and general rules disagree | |

## C12 Ficha técnica

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Nenhum item na lista dos 20 ainda. | `apps/web/app/console/(app)/contas/[code]/fichas/page.tsx:86` | Top-20 list empty | |
| Nenhuma ficha pronta ainda. | `apps/web/app/console/(app)/contas/[code]/fichas/page.tsx:111` | No ready recipe yet | |
| custo recalculando | `apps/web/app/console/(app)/contas/[code]/fichas/page.tsx:121` | Cost cell while the cost job runs | |
| Rendimento {insumo}: como foi obtido | `apps/web/app/console/(app)/contas/[code]/fichas/page.tsx:171` | Accessible name of the yield select | |
| medido | `apps/web/app/console/(app)/contas/[code]/fichas/page.tsx:174`<br>`apps/web/lib/m3/edit.ts:11`<br>`apps/web/lib/m3/format.ts:99` | Yield select option | |
| estimado | `apps/web/app/console/(app)/contas/[code]/fichas/page.tsx:176`<br>`apps/web/lib/m3/edit.ts:11`<br>`apps/web/lib/m3/format.ts:99` | Yield select option | |
| Embalagem extra por canal | `apps/web/app/console/(app)/contas/[code]/fichas/page.tsx:204` | Recipe editor: packaging per channel | |
| Confira os valores: quantidade e rendimento maiores que zero. | `apps/web/app/console/(app)/contas/[code]/fichas/page.tsx:223` | Recipe editor: invalid quantity or yield | |
| Embalagem extra: {canal} {valor}, ... | `apps/web/app/console/(app)/contas/[code]/fichas/page.tsx:245` | Recipe summary when there is extra packaging | |
| Editar ficha | `apps/web/app/console/(app)/contas/[code]/fichas/page.tsx:255` | Link that opens the recipe editor | |
| dos rendimentos {medidos \| estimados} | `apps/web/lib/m3/format.ts:107` | Error-bar explanation, yield part | |
| A barra de erro vem {parte}. Todos os preços são de nota. | `apps/web/lib/m3/format.ts:110` | Error-bar explanation when all prices come from invoices | |
| do preço que ainda é estimativa regional | `apps/web/lib/m3/format.ts:113` | Error-bar explanation, price part | |

## C13 Contribuição

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Fechamento gerado: o PDF está na fila. O dono foi avisado. | `apps/web/app/console/(app)/contas/[code]/contribuicao/[yyyy-mm]/page.tsx:102` | After "Gerar fechamento" on C13; same optional parts as C09 | |
| {frase anterior} Uma linha pode inverter com um erro desse tamanho: está marcada. | `apps/web/lib/m3/format.ts:166` | Note under the table when one row can flip sign | |
| {frase anterior} {n} linhas podem inverter com um erro desse tamanho: estão marcadas. | `apps/web/lib/m3/format.ts:167` | Same note, several rows | |
| {nome} deixa só {valor} por pedido no {canal}, a menor sobra entre os itens que mais vendem. | `apps/web/lib/m3/format.ts:185` | DLV-01 second sentence (also on W01) | |

## C14 Configurações

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| falta: {o que falta} | `apps/web/app/console/(app)/config/page.tsx:18` | Settings row when an environment variable is missing | |
| CNPJ final {cnpj} | `apps/web/lib/console/settings.ts:96` | Authorization row when an account has several CNPJs | |

## C15 Assinaturas

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Salvo. | `apps/web/app/console/(app)/assinaturas/Forms.tsx:15` | After saving a plan or pilot | |
| Início do piloto | `apps/web/app/console/(app)/assinaturas/Forms.tsx:77` | Pilot form field | |
| Preço por mês (R$) | `apps/web/app/console/(app)/assinaturas/Forms.tsx:125` | Plan editor field | |
| Cobrado por | `apps/web/app/console/(app)/assinaturas/Forms.tsx:131` | Plan editor field (unit) | |
| Dias de teste grátis | `apps/web/app/console/(app)/assinaturas/Forms.tsx:140` | Plan editor field | |
| Raio-X de concorrente por mês | `apps/web/app/console/(app)/assinaturas/Forms.tsx:146` | Plan editor field | |
| preço de exemplo | `apps/web/app/console/(app)/assinaturas/Forms.tsx:152` | Plan editor checkbox | |
| cozinha ativa | `apps/web/app/console/(app)/assinaturas/page.tsx:28` | Unit word in the subscriptions table ("loja ativa" for store plans) | |
| Só o papel Fundador muda planos e pilotos. | `apps/web/lib/billing/admin.ts:19` | A non-founder tries to save | |
| Preço inválido. Use reais, por exemplo 300 ou 300,00. | `apps/web/lib/billing/admin.ts:20` | Plan editor: bad price | |
| Dias de teste: um número de 0 a 90. | `apps/web/lib/billing/admin.ts:21` | Plan editor: bad trial days | |
| Raio-X de concorrente por mês: um número de 0 a 99. | `apps/web/lib/billing/admin.ts:22` | Plan editor: bad competitor limit | |
| Percentual inválido. Use, por exemplo, 20%. | `apps/web/lib/billing/admin.ts:23` | Pilot form: bad percent | |
| Teto inválido. Use reais, por exemplo 500. | `apps/web/lib/billing/admin.ts:24` | Pilot form: bad cap | |
| Valor a partir do mês 3 inválido. Use reais, por exemplo 300. | `apps/web/lib/billing/admin.ts:25` | Pilot form: bad month-3 price | |
| Data de início inválida. | `apps/web/lib/billing/admin.ts:26` | Pilot form: bad start date | |
| Escolha a conta. | `apps/web/lib/billing/admin.ts:27` | Pilot form: no account chosen | |
| Esta conta já tem piloto. | `apps/web/lib/billing/admin.ts:28` | Pilot form: account already has a pilot | |
| Não encontrado. | `apps/web/lib/billing/admin.ts:29` | Plan or pilot id not found | |
| fim do teste, voltou ao grátis | `apps/web/lib/billing/jobs.ts:49` | Last-event label when the trial ends without a plan | |
| MargoAI piloto, {mm}/{aaaa}: {pct}% do creditado | `apps/web/lib/billing/jobs.ts:172` | Asaas charge description of a pilot (on the owner's invoice) | |
| teste: acaba hoje | `apps/web/lib/billing/view.ts:324` | Status on the trial's last day | |
| assinatura criada | `apps/web/lib/billing/webhook.ts:123` | Last-event label | |
| assinatura cancelada | `apps/web/lib/billing/webhook.ts:160` | Last-event label | |

## C16 Contestação

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Só uma contestação em análise pode ser marcada como negada. | `apps/web/app/console/(app)/contas/[code]/contestacoes/actions.ts:31` | "Foi negada" on a claim not in analysis | |
| conferir o próximo repasse | `apps/web/lib/m2/contestations.ts:78` | Next step of a claim marked "contestada" | |
| esperar o próximo repasse | `apps/web/lib/m2/contestations.ts:86` | Next step while waiting for a payout | |
| Em {mês}, {n} pedido(s) tiveram comissão de {cobrado}%, mas o contrato diz {contrato}%. Diferença: {valor}. Segue planilha com os pedidos. | `workers/import/src/margo_import/claims.py:50` | DIF-01 claim text | |
| Em {mês}, {n} pedido(s) {foi cancelado \| foram cancelados} {pelo cliente \| por {motivo}} e o valor foi cobrado da loja. Diferença: {valor}. Segue planilha com os pedidos. | `workers/import/src/margo_import/claims.py:59` | DIF-02 claim text | |
| {parte}% do desconto | `workers/import/src/margo_import/claims.py:63` | DIF-03 coupon claim when the app's share is not half | |
| Em {mês}, {n} pedido(s) tiveram promoção debitada da loja sem acordo registrado conosco. Diferença: {valor}. Segue planilha com os pedidos. | `workers/import/src/margo_import/claims.py:71` | DIF-03 claim text without a campaign | |
| Em {mês}, {n} pedido(s) entregue(s) {ficou \| ficaram} sem repasse. Diferença: {valor}. Segue planilha com os pedidos. | `workers/import/src/margo_import/claims.py:75` | DIF-04 claim text | |

## C17 Corrigir importação

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Vira o campo: {nome} | `apps/web/app/console/(app)/importacoes/[id]/corrigir/page.tsx:78` | Accessible name of a column's field select | |
| data do pedido | `apps/web/lib/m2/mapping.ts:16`<br>`workers/import/src/margo_import/layout.py:35` | Field name in the column mapping select | |
| situação do pedido | `apps/web/lib/m2/mapping.ts:17`<br>`workers/import/src/margo_import/layout.py:36` | Field name in the column mapping select | |
| cancelado por | `apps/web/lib/m2/mapping.ts:18`<br>`workers/import/src/margo_import/layout.py:37` | Field name in the column mapping select | |
| motivo do cancelamento | `apps/web/lib/m2/mapping.ts:19`<br>`workers/import/src/margo_import/layout.py:38` | Field name in the column mapping select | |
| taxa de entrega do cliente | `apps/web/lib/m2/mapping.ts:22`<br>`workers/import/src/margo_import/layout.py:41` | Field name in the column mapping select | |
| itens do pedido | `apps/web/lib/m2/mapping.ts:23`<br>`workers/import/src/margo_import/layout.py:42` | Field name in the column mapping select | |
| taxa de pagamento | `apps/web/lib/m2/mapping.ts:26`<br>`workers/import/src/margo_import/layout.py:45` | Field name in the column mapping select | |
| promoção paga pela loja | `apps/web/lib/m2/mapping.ts:28`<br>`workers/import/src/margo_import/layout.py:47` | Field name in the column mapping select | |
| data do repasse | `apps/web/lib/m2/mapping.ts:35`<br>`workers/import/src/margo_import/layout.py:54` | Field name in the column mapping select | |
| data prevista do repasse | `apps/web/lib/m2/mapping.ts:36`<br>`workers/import/src/margo_import/layout.py:55` | Field name in the column mapping select | |
| id da transação | `apps/web/lib/m2/mapping.ts:38`<br>`workers/import/src/margo_import/layout.py:57` | Field name in the column mapping select | |
| falta o campo repasse | `apps/web/lib/m2/mapping.ts:69` | Payout check when no column is mapped to payout | |
| {valor} · não bate ({valor}) | `apps/web/lib/m2/mapping.ts:71` | Payout check when the sum does not match | |
| Esta importação não espera mapeamento. | `apps/web/lib/m2/mapping.ts:118` | Saving a mapping for an import that is not waiting | |
| A soma do repasse não bate. Confira a coluna do repasse antes de salvar. | `apps/web/lib/m2/mapping.ts:119` | Saving while the payout sum does not match | |
| Diga o que significa: {colunas}. | `apps/web/lib/m2/mapping.ts:121` | Saving with undecided columns | |
| Faltam os campos: {campos}. | `apps/web/lib/m2/mapping.ts:122` | Saving with required fields unmapped | |

## C18 Parceiros BPO

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Logo em PNG ou SVG, até 512 KB. | `apps/web/app/console/(app)/bpo/actions.ts:36` | Logo upload of a wrong type or size | |
| {n} fechamento(s) na fila com a marca do {parceiro}. | `apps/web/app/console/(app)/bpo/actions.ts:99` | After "gerar" with the BPO brand | |
| Nenhum fechamento pronto nos clientes deste BPO. | `apps/web/app/console/(app)/bpo/actions.ts:99` | After "gerar" with the BPO brand | |
| Logo do BPO (PNG ou SVG): {arquivo} | `apps/web/app/console/(app)/bpo/page.tsx:85` | Brand form: current logo | |
| Salvar marca | `apps/web/app/console/(app)/bpo/page.tsx:107` | Brand form: button | |
| Fechamentos com a marca do {nome} | `apps/web/app/console/(app)/bpo/page.tsx:115` | Section title: closes with the partner's brand | |
| não encontrado | `apps/web/app/console/(app)/bpo/pdf/[job]/route.ts:9` | Branded PDF not found (plain 404 text) | |
| nenhum cliente ainda | `apps/web/lib/console/bpo.ts:44` | Clients column of a partner without clients or note | |
| criada, sem arquivos | `apps/web/lib/console/bpo.ts:49` | Folder column: created, nothing arrived | |
| gerando | `apps/web/lib/console/bpo.ts:131` | Branded PDF job status | |

## C19 Estrutura do cliente

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| arquivo do portal | `apps/web/lib/m2/structure.ts:54` | Store source when it comes from the portal file | |
| loja ou cozinha de outra conta | `apps/web/lib/m2/structure.ts:129` | "vincular" with a store or kitchen of another account | |

## C20 Funcionalidades

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Nova exceção para {chave} | `apps/web/app/console/(app)/funcionalidades/ExceptionForm.tsx:16` | Accessible name of the exception form | |
| Motivo | `apps/web/app/console/(app)/funcionalidades/ExceptionForm.tsx:37` | Exception form field | |
| Salvar exceção | `apps/web/app/console/(app)/funcionalidades/ExceptionForm.tsx:46` | Exception form button | |
| remover exceção {conta} de {chave} | `apps/web/app/console/(app)/funcionalidades/page.tsx:79` | Accessible name of the remove-exception button | |
| Só o papel Fundador muda funcionalidades. | `apps/web/lib/flags/admin.ts:42` | A non-founder tries to change a flag | |
| Escreva o motivo da exceção. | `apps/web/lib/flags/admin.ts:43` | Exception without a reason | |
| Funcionalidade, plano ou ambiente inválido. | `apps/web/lib/flags/admin.ts:44` | Bad flag, plan or environment | |

## C21 Alertas

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Nenhum alerta aberto. | `apps/web/app/console/(app)/alertas/page.tsx:51` | No open alert | |
| resolver: {título} | `apps/web/app/console/(app)/alertas/page.tsx:74` | Accessible name of "resolver" | |
| WhatsApp para mandar | `apps/web/app/console/(app)/alertas/page.tsx:99` | Manual WhatsApp queue: section title | |
| Até o WhatsApp Business, quem está de plantão manda cada mensagem pelo link e marca como enviada. Das 22h às 8h as mensagens para o dono esperam. | `apps/web/app/console/(app)/alertas/page.tsx:102` | Manual WhatsApp queue: lead | |
| Nenhuma mensagem para mandar. | `apps/web/app/console/(app)/alertas/page.tsx:125` | Manual WhatsApp queue empty | |
| espera até 8h | `apps/web/app/console/(app)/alertas/page.tsx:137` | Queue row during quiet hours (22h to 8h) | |
| sem WhatsApp | `apps/web/app/console/(app)/alertas/page.tsx:138` | Queue row for a person without WhatsApp | |
| abrir no WhatsApp | `apps/web/app/console/(app)/alertas/page.tsx:143` | Queue row link | |
| marcar enviada | `apps/web/app/console/(app)/alertas/page.tsx:152` | Queue row button | |
| Pediu o plano Rede | `apps/web/lib/billing/service.ts:121` | Alert title: an owner asked for the Rede plan | |
| Cobrança do piloto não foi criada no Asaas | `apps/web/lib/billing/service.ts:122` | Alert title: a pilot charge failed to reach Asaas | |
| Assinatura sem cozinha ou loja na análise | `apps/web/lib/billing/service.ts:123` | Alert title: subscription with 0 units | |
| Só a equipe da MargoAI resolve alertas. | `apps/web/lib/notify/alerts.ts:45` | Non-staff tries to resolve | |
| Alerta não encontrado. | `apps/web/lib/notify/alerts.ts:46` | Alert id not found | |
| Este alerta já foi resolvido. | `apps/web/lib/notify/alerts.ts:47` | Resolving twice | |
| Abrir: {link} | `apps/web/lib/notify/alerts.ts:54` | Team alert e-mail: link line | |
| O alerta fica em Alertas até alguém da equipe resolver. | `apps/web/lib/notify/alerts.ts:55` | Team alert e-mail: last line | |
| Alerta: {título do alerta} | `apps/web/lib/notify/manual-queue.ts:64` | Queue "Aviso" column for an alert | |
| Só a equipe da MargoAI marca mensagens de WhatsApp. | `apps/web/lib/notify/manual-queue.ts:110` | Non-staff tries to mark sent | |
| Mensagem não encontrada. | `apps/web/lib/notify/manual-queue.ts:111` | Message id not found | |
| Horário de silêncio: a mensagem espera até 8h. | `apps/web/lib/notify/manual-queue.ts:112` | Mark sent during quiet hours | |
| Esta pessoa não tem WhatsApp cadastrado. | `apps/web/lib/notify/manual-queue.ts:113` | Mark sent for a person without WhatsApp | |
| Esta mensagem já foi marcada como enviada. | `apps/web/lib/notify/manual-queue.ts:114` | Marking sent twice | |
| Verificar acesso do único Dono: CNPJ {cnpj}, contato {contato} | `apps/web/lib/portal/entry.ts:216` | Alert title: P17 verification request | |
| Tarefa %s travou 2 vezes: mais de 30 minutos rodando | `supabase/migrations/20261031000006_jobs.sql:79` | Alert title: a job stuck twice (SQL sweeper) | |
| Tarefa {tarefa} travou 2 vezes: mais de 30 minutos rodando | `workers/common/src/margo_common/stores.py:110` | Alert title: a job stuck twice (worker sweeper) | |
| Tarefa %s travou na última tentativa: mais de 30 minutos rodando | `supabase/migrations/20261228000001_m1_extract_retry.sql` (`requeue_stuck_jobs`) | Alert title: an extract job stuck on its last attempt | |

## P07 Criar conta

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Entramos com um código no seu e-mail, sem senha. No fim do teste você escolhe um plano, ou a conta volta para o raio-X grátis. | `apps/web/app/criar-conta/page.tsx:27` | Note under the sign-up form | |
| Escreva seu nome e o nome do restaurante. | `apps/web/lib/portal/entry.ts:15` | Sign-up without names | |
| Confira o CNPJ: os números não batem. | `apps/web/lib/portal/entry.ts:17` | CNPJ check digits wrong | |
| Confira o e-mail. | `apps/web/lib/portal/entry.ts:18` | E-mail invalid | |
| Confira o WhatsApp, com DDD. | `apps/web/lib/portal/entry.ts:19` | WhatsApp invalid | |
| Para continuar, aceite os termos e a política de privacidade. | `apps/web/lib/portal/entry.ts:20` | Terms box not checked | |
| Este e-mail já está em uso. Use outro. | `apps/web/lib/portal/entry.ts:22` | E-mail already has a login | |

## P11 Termos e privacidade

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| O texto completo entra aqui depois da consulta jurídica. | `apps/web/app/termos/page.tsx:40` | Placeholder until the legal text arrives | |

## P17 Não consigo entrar

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Pedir verificação pela equipe | `apps/web/app/nao-consigo-entrar/page.tsx:35` | Section title of the verification request | |
| E-mail ou WhatsApp para falarmos com você | `apps/web/components/portal/VerificationForm.tsx:35` | Verification form field | |
| Pedir verificação | `apps/web/components/portal/VerificationForm.tsx:45` | Verification form button | |
| Pedido enviado. A equipe da MargoAI confere pelo CNPJ e pelo contrato social e fala com você pelo contato informado. | `apps/web/lib/portal/entry.ts:24` | After sending the verification request | |
| Escreva um e-mail ou WhatsApp para a equipe falar com você. | `apps/web/lib/portal/entry.ts:25` | Verification request without a contact | |

## P18 Aceitar convite

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Convite inválido | `apps/web/app/convite/[token]/page.tsx:19` | Invite link expired or used | |
| Este convite venceu ou já foi usado. Peça um convite novo para quem te convidou. | `apps/web/lib/portal/entry.ts:21` | Invite expired or used (message) | |
| Você já faz parte desta conta. Entre com o seu e-mail. | `apps/web/lib/portal/entry.ts:23` | Accepting an invite to an account you are already in | |
| Você ainda não vê nenhuma cozinha. Não vê cobrança. | `apps/web/lib/portal/entry.ts:126` | What a Gerente with no kitchen sees | |
| Você vai ver o fechamento, as contestações e as notas de todas as cozinhas. Não vê cobrança nem pessoas. | `apps/web/lib/portal/entry.ts:128` | What a Financeiro sees | |
| Você vai ver tudo da conta, inclusive cobrança e pessoas. | `apps/web/lib/portal/entry.ts:129` | What a Dono sees | |
| Convite enviado por e-mail para {e-mail}. | `apps/web/lib/portal/entry.ts:152` | Invite sent by e-mail (drawn: WhatsApp version) | |

## W01 / P08 Início

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| não autorizado | `apps/web/app/app/page.tsx:164` | Data sources: iFood not authorized | |
| não instalada | `apps/web/app/app/page.tsx:169` | Data sources: extension not installed | |
| falta custo | `apps/web/app/app/page.tsx:235`<br>`apps/web/app/app/page.tsx:264` | KPI and table cell when m3.custo is off or cost is missing | |
| Não encontrado | `apps/web/app/app/relatorios/fechamento/[id]/[formato]/route.ts:9` | Close PDF/xlsx link not found (plain 404 text) | |

## W02 / P13 Lojas

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Você trocou um contato de login. Por 24 horas, você não pode mudar o plano. | `apps/web/app/app/lojas/actions.ts:23` | Lock: the person changed a login contact in the last 24 h | |
| Seu plano analisa uma cozinha. Para incluir mais, mude o plano. | `apps/web/app/app/lojas/actions.ts:26` | Adding a kitchen beyond the plan | |
| sem dados ainda | `apps/web/lib/portal/lojas.ts:82` | Channel with no data yet | |
| sem lojas ainda | `apps/web/lib/portal/lojas.ts:95` | Kitchen with no stores yet | |

## W03 / P12 Contestações

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Essa contestação já mudou. Confira a lista de novo. | `apps/web/app/app/contestacoes/actions.ts:29` | Marking a claim someone else already changed | |

## W04 / P14 Pessoas e acessos

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Convite criado. Ele vale por 7 dias e só pode ser usado uma vez. | `apps/web/app/app/pessoas/InviteForm.tsx:20` | After creating an invite | |
| Link do convite | `apps/web/app/app/pessoas/InviteForm.tsx:21` | Accessible name of the link field | |
| Mandar por | `apps/web/app/app/pessoas/InviteForm.tsx:51` | Invite form: channel choice | |
| WhatsApp com DDD ou e-mail | `apps/web/app/app/pessoas/InviteForm.tsx:59` | Invite form: contact field | |
| Cozinhas (marque pelo menos uma) | `apps/web/app/app/pessoas/InviteForm.tsx:68` | Invite form: kitchens legend (Gerente / other profiles) | |
| Cozinhas (nenhuma marcada: todas) | `apps/web/app/app/pessoas/InviteForm.tsx:68` | Invite form: kitchens legend (Gerente / other profiles) | |
| Mandar pelo WhatsApp | `apps/web/app/app/pessoas/actions.ts:85` | Share button after the invite | |
| Convite para a MargoAI | `apps/web/app/app/pessoas/actions.ts:86` | E-mail subject and share button | |
| Mandar por e-mail | `apps/web/app/app/pessoas/actions.ts:86` | E-mail subject and share button | |
| Escolha o perfil. | `apps/web/app/app/pessoas/actions.ts:101` | Invite without profile | |
| Confira o e-mail. | `apps/web/app/app/pessoas/actions.ts:102` | Invite with a bad e-mail or WhatsApp | |
| Confira o número do WhatsApp com DDD. | `apps/web/app/app/pessoas/actions.ts:102` | Invite with a bad e-mail or WhatsApp | |
| Salvar cozinhas | `apps/web/app/app/pessoas/page.tsx:36` | Kitchen editor button | |
| Você trocou um contato de login. Até {data}, você não pode mudar pessoas nem o plano. | `apps/web/app/app/pessoas/page.tsx:97` | Lock banner for the person who changed a login contact | |
| Toda conta precisa de pelo menos um Dono. Faça outra pessoa Dono antes. | `apps/web/lib/portal/scope.ts:82` | Removing or demoting the last Dono | |
| Você trocou um contato de login. Por 24 horas, você não pode mudar pessoas. | `apps/web/lib/portal/scope.ts:83` | Lock refusal (person changed a login contact) | |
| Escolha pelo menos uma cozinha. | `apps/web/lib/portal/scope.ts:85` | Gerente saved without kitchens | |
| Escolha cozinhas desta conta. | `apps/web/lib/portal/scope.ts:86` | Kitchen from another account | |
| Esse contato já tem acesso à conta. | `apps/web/lib/portal/scope.ts:87` | Inviting someone already in the account | |
| Esse convite já foi aceito. | `apps/web/lib/portal/scope.ts:88` | Revoking an invite already accepted | |
| Não deu certo. Tente de novo. | `apps/web/lib/portal/scope.ts:93` | Any other people error | |
| Escolha pelo menos uma cozinha para o Gerente de cozinha. | `apps/web/lib/portal/scope.ts:98` | Gerente invite without kitchens | |
| {nome} convidou você para ver a conta {conta} na MargoAI como {perfil}. O convite vale por 7 dias: {link} | `apps/web/lib/portal/scope.ts:114` | Text sent with the invite link (WhatsApp or e-mail) | |

## W05 / P09 Plano e cobrança

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Você trocou um contato de login. Por 24 horas, você não pode mudar o plano. | `apps/web/lib/billing/checkout.ts:16` | Lock: the person changed a login contact in the last 24 h | |
| Sua conta já tem o plano Lucro. | `apps/web/lib/billing/checkout.ts:17` | Checkout when Lucro is already active | |
| Escolha ao menos uma {cozinha \| loja} para a análise antes de assinar. | `apps/web/lib/billing/checkout.ts:18` | Checkout with 0 kitchens or stores | |
| Cadastre o CNPJ da empresa antes de assinar. | `apps/web/lib/billing/checkout.ts:19` | Checkout without a company CNPJ | |
| Não conseguimos abrir o pagamento agora. Tente de novo em alguns minutos. | `apps/web/lib/billing/checkout.ts:20` | Asaas checkout unavailable | |
| Recebemos o pedido. Os fundadores falam com você em breve. | `apps/web/lib/billing/checkout.ts:21` | After asking for the Rede plan | |
| MargoAI plano Lucro, a partir de {data}: {n} {cozinhas \| lojas} | `apps/web/lib/billing/jobs.ts:227` | Asaas subscription description (on the owner's invoice) | |
| atrasada | `apps/web/lib/billing/view.ts:96`<br>`apps/web/lib/billing/view.ts:321` | Invoice or subscription status | |
| cancelada | `apps/web/lib/billing/view.ts:98`<br>`apps/web/lib/billing/view.ts:332` | Invoice status | |
| acaba hoje | `apps/web/lib/billing/view.ts:119` | Trial ends today (drawn: "acaba em 9 dias") | |
| Seu plano | `apps/web/lib/billing/view.ts:139` | Button on the current plan's card | |
| Plano Lucro escolhido. A primeira cobrança sai em {data}, quando o teste acabar. Só cartão de crédito, pelo Asaas. | `apps/web/lib/billing/view.ts:169` | Lucro chosen during the trial (computer lead) | |
| Seu plano: {nome} | `apps/web/lib/billing/view.ts:172` | Paying: phone title | |
| O Asaas não conseguiu cobrar o cartão. Confira o cartão pela fatura. | `apps/web/lib/billing/view.ts:173` | Past due: phone lead | |
| {título}. Próxima cobrança em {data}. Só cartão de crédito, pelo Asaas. | `apps/web/lib/billing/view.ts:174` | Paying: computer lead | |
| Seu plano: Raio-X grátis | `apps/web/lib/billing/view.ts:177` | Free after the trial or canceled: phone title | |
| O fechamento por canal parou de atualizar. Escolha o Lucro para voltar. | `apps/web/lib/billing/view.ts:178` | Free after the trial or canceled: phone lead | |
| Plano Raio-X grátis. Só cartão de crédito, pelo Asaas. | `apps/web/lib/billing/view.ts:179` | Free after the trial or canceled: computer lead | |
| Pagamento processando. Assim que o Asaas confirmar, o plano aparece aqui. | `apps/web/lib/billing/view.ts:183` | Back from Asaas, payment pending | |
| Pagamento não concluído. Nada foi cobrado. | `apps/web/lib/billing/view.ts:184` | Back from Asaas, payment canceled | |

## W06 / P15 Entrar

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Qual grupo abrir? | `apps/web/app/entrar/conta/page.tsx:19` | Login of a person in several groups: group chooser | |

## W07 / P03 Conectar os apps

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Entre no portal para conectar a extensão. | `apps/web/app/api/extension/code/route.ts:12` | Asking for a pairing code without a session | |
| Marque a autorização para continuar. | `apps/web/app/app/conectar/actions.ts:16` | Authorization box not checked | |
| Escolha o CNPJ que você autoriza. | `apps/web/app/app/conectar/actions.ts:20` | No CNPJ chosen | |
| Não deu certo. Tente de novo. | `apps/web/components/portal/PairingCode.tsx:19` | Pairing code request failed | |
| Mostrar o código da extensão | `apps/web/components/portal/PairingCode.tsx:27` | Button that shows the pairing code | |
| Digite este código na extensão. Vale até {hora} e uma vez só. | `apps/web/components/portal/PairingCode.tsx:34` | After the code shows | |
| aguardando | `apps/web/lib/portal/connect.ts:41` | Step 1 pill before iFood returns stores | |

## W08 / P16 Notificações

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| O exemplo aparece quando houver o primeiro fechamento. | `apps/web/app/app/notificacoes/exemplo/page.tsx:40` | E-mail example page before the first close | |
| Você não faz parte desta conta. | `apps/web/lib/notify/prefs.ts:11` | Preference change by someone outside the account | |
| Este aviso não existe. | `apps/web/lib/notify/prefs.ts:12` | Unknown notice code | |

## W09 Segurança e acesso

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Não encontrado | `apps/web/app/app/dados/[job]/route.ts:8` | Export download not found (plain 404 text) | |
| Sair do {nome} | `apps/web/app/app/seguranca/page.tsx:73` | Accessible name of a device's remove button | |
| Baixar o arquivo de {data} | `apps/web/app/app/seguranca/page.tsx:107` | Export ready | |
| Arquivo de {data} em preparação. | `apps/web/app/app/seguranca/page.tsx:110` | Export being prepared | |
| Novo e-mail | `apps/web/components/portal/W09Forms.tsx:51` | Change e-mail form field | |
| Confirmar a exclusão | `apps/web/components/portal/W09Forms.tsx:105` | Account deletion: confirm button | |
| Escreva um e-mail válido. | `apps/web/lib/portal/contact-change.ts:17` | Change e-mail: invalid | |
| Esse já é o seu e-mail de login. | `apps/web/lib/portal/contact-change.ts:18` | Change e-mail: same as now | |
| Esse e-mail já é usado por outra pessoa na MargoAI. | `apps/web/lib/portal/contact-change.ts:19` | Change e-mail: used by someone else | |
| E-mail trocado. Avisamos o endereço antigo. Por 24 horas, você não pode mudar o plano nem as pessoas. | `apps/web/lib/portal/contact-change.ts:21` | Change e-mail done, Dono (with the lock) | |
| {nome} aceitou o convite | `apps/web/lib/portal/security.ts:84` | Access log line | |
| {nome} saiu de todos os aparelhos | `apps/web/lib/portal/security.ts:86` | Access log line | |
| {nome} tirou um aparelho da conta | `apps/web/lib/portal/security.ts:88` | Access log line | |
| Estamos preparando o arquivo com todos os dados. Ele aparece aqui para baixar em alguns minutos. | `apps/web/lib/portal/security.ts:115` | After asking for the data export | |
| Pedido de exclusão recebido. Mandamos a confirmação por e-mail. Tudo é apagado em até 90 dias. | `apps/web/lib/portal/security.ts:116` | After asking for deletion | |
| Para confirmar com código, a conta precisa de um e-mail de login. | `apps/web/lib/portal/security.ts:117` | Code confirmation for a person without e-mail login | |

## E-mails and notices

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Pessoa nova na conta | `apps/web/app/app/pessoas/actions.ts:122`<br>`apps/web/emails/notices.ts:195`<br>`apps/web/lib/portal/entry.ts:194` | security_event (new person): subject, from the invite, its acceptance and the notice | |
| {nome} convidou {convidado} para a conta {conta} como {perfil}. | `apps/web/app/app/pessoas/actions.ts:122` | security_event to the Donos after an invite: subject and body | |
| não encontrado | `apps/web/app/console/(app)/emails/[code]/html/route.ts:14` | Console e-mail preview of an unknown code (plain 404 text) | |
| {código da tela} · Alertas · e-mails dos avisos | `apps/web/app/console/(app)/emails/[code]/page.tsx:25` | Console e-mail preview: eyebrow | |
| Mandar os 10 exemplos para o inbox local | `apps/web/app/console/(app)/emails/[code]/page.tsx:57` | Console e-mail preview: button (local only) | |
| Só no ambiente local: vão para o Mailpit, e o WhatsApp para a fila em Alertas. | `apps/web/app/console/(app)/emails/[code]/page.tsx:59` | Console e-mail preview: note (local only) | |
| falta custo | `apps/web/emails/E01-fechamento.ts:32` | E01 "sobrou" value when m3.custo is off or cost is missing | |
| {mês} fechado: recebeu {valor} de {valor} | `apps/web/emails/E01-fechamento.ts:43` | E01 subject | |
| Falta 1 dia para contestar {valor} no {canal} | `apps/web/emails/E02-prazo.ts:34` | E02 subject with 1 day left (drawn: "Faltam 3 dias") | |
| Abra um chamado no {portal da 99Food \| portal do {canal}} e cole o texto. | `apps/web/emails/E02-prazo.ts:42` | E02 step 2 for 99Food and other channels | |
| SINTÉTICO · dados fictícios | `apps/web/emails/layout.ts:12` | Label on every e-mail from a synthetic account | |
| Diferença nova no repasse: {valor} no {canal} | `apps/web/emails/notices.ts:19` | new_difference: subject | |
| Ver a diferença | `apps/web/emails/notices.ts:23` | new_difference: button | |
| O texto para contestar já está pronto no seu portal. | `apps/web/emails/notices.ts:24` | new_difference: body | |
| Crédito confirmado: {valor} voltaram do {canal} | `apps/web/emails/notices.ts:41` | credit_confirmed: subject | |
| O {canal} devolveu {valor} | `apps/web/emails/notices.ts:42` | credit_confirmed: title | |
| O crédito de {o quê} apareceu no repasse de {data}. A gente marcou a contestação como creditada. | `apps/web/emails/notices.ts:44` | credit_confirmed: body | |
| Ver contestações | `apps/web/emails/notices.ts:45` | credit_confirmed: button | |
| A autorização do iFood foi retirada | `apps/web/emails/notices.ts:62` | data_stale (iFood authorization revoked): subject | |
| Paramos de receber os dados da {loja} | `apps/web/emails/notices.ts:63` | data_stale (revoked): title | |
| A permissão da MargoAI no Portal do Parceiro foi retirada. Sem ela, o fechamento e as diferenças param. | `apps/web/emails/notices.ts:65` | data_stale (revoked): body | |
| Abra o Portal do Parceiro, em Aplicativos. | `apps/web/emails/notices.ts:66` | data_stale (revoked): steps | |
| Toque em Permitir na MargoAI. | `apps/web/emails/notices.ts:66` | data_stale (revoked): steps | |
| Seus dados do iFood estão parados há {dias} | `apps/web/emails/notices.ts:74` | data_stale (extension silent 3 days): subject | |
| A extensão não manda dados da {loja} há {dias} | `apps/web/emails/notices.ts:75` | data_stale (extension): title | |
| A extensão só envia quando você abre o Portal do Parceiro no computador. Abra o portal e toque em Exportar e enviar. | `apps/web/emails/notices.ts:77` | data_stale (extension): body | |
| Faltam notas de {n} | `apps/web/emails/notices.ts:92` | invoices_missing: subject | |
| Faltam notas de compra de {n} | `apps/web/emails/notices.ts:93` | invoices_missing: title | |
| Sem a nota, o custo usa a estimativa da região: {insumos}. | `apps/web/emails/notices.ts:95` | invoices_missing: body | |
| Mande a chave ou a foto do QR da nota pelo WhatsApp, ou peça o arquivo XML ao seu contador. | `apps/web/emails/notices.ts:96` | invoices_missing: body | |
| Resumo da semana: vendeu {valor} | `apps/web/emails/notices.ts:116` | weekly_summary: subject | |
| Sua semana de {semana} | `apps/web/emails/notices.ts:117` | weekly_summary: title | |
| Diferenças novas | `apps/web/emails/notices.ts:124` | weekly_summary: table row | |
| Contestações abertas | `apps/web/emails/notices.ts:125` | weekly_summary: table row | |
| Seu teste grátis acaba {quando}, em {data} | `apps/web/emails/notices.ts:145` | trial_ending: title | |
| Sem um plano, a conta volta para o Raio-X grátis: as importações dos apps param e seus dados ficam guardados. | `apps/web/emails/notices.ts:147` | trial_ending: body | |
| Cobrança aprovada: {valor} | `apps/web/emails/notices.ts:164` | billing_result approved: subject | |
| Recebemos {valor} do plano {plano} | `apps/web/emails/notices.ts:165` | billing_result approved: title | |
| Obrigado. A nota e o recibo ficam em Plano e cobrança. | `apps/web/emails/notices.ts:167` | billing_result approved: body | |
| Ver plano e cobrança | `apps/web/emails/notices.ts:168` | billing_result approved: button | |
| O cartão recusou a cobrança de {valor} | `apps/web/emails/notices.ts:175` | billing_result refused: title | |
| O plano {plano} segue ativo por enquanto. Troque o cartão para a próxima tentativa. | `apps/web/emails/notices.ts:177` | billing_result refused: body | |
| Trocar o cartão | `apps/web/emails/notices.ts:178` | billing_result refused: button | |
| {nome} entrou na sua conta | `apps/web/emails/notices.ts:196` | security_event (new person): title | |
| Se você não convidou essa pessoa, tire o acesso dela em Pessoas. | `apps/web/emails/notices.ts:198` | security_event (new person): body | |
| Ver pessoas | `apps/web/emails/notices.ts:199` | security_event (new person): button | |
| {nome} entrou na MargoAI por um aparelho novo ({aparelho}). | `apps/web/emails/notices.ts:209` | security_event (new device): body | |
| Se não foi você, saia de todos os aparelhos em Segurança. | `apps/web/emails/notices.ts:210` | security_event (new device): body | |
| Ver aparelhos | `apps/web/emails/notices.ts:211` | security_event (new device): button | |
| em 3 dias, no dia {data} | `apps/web/lib/billing/service.ts:94` | trial_ending plain text: "when" 3 days before | |
| Seu teste grátis acaba hoje | `apps/web/lib/billing/service.ts:96` | trial_ending plain text: subject on the last day | |
| O teste grátis da MargoAI acaba {quando}. | `apps/web/lib/billing/service.ts:98` | trial_ending plain text: body | |
| Para continuar com o fechamento por canal e as diferenças no repasse, escolha um plano: {link} | `apps/web/lib/billing/service.ts:99` | trial_ending plain text: body | |
| Se não escolher, a conta volta para o Raio-X grátis e os dados de canal param de atualizar. Nada é cobrado. | `apps/web/lib/billing/service.ts:100` | trial_ending plain text: body | |
| A cobrança de {valor} ({plano}) foi aprovada no cartão. ↵ Faturas: {link} | `apps/web/lib/billing/service.ts:109` | billing_result plain text: approved | |
| A cobrança de {valor} ({plano}) foi recusada no cartão. ↵ Confira o cartão no Asaas pela fatura ou fale com a gente. Faturas: {link} | `apps/web/lib/billing/service.ts:112` | billing_result plain text: refused | |
| plano Lucro, piloto a partir do dia 61 | `apps/web/lib/billing/webhook.ts:178` | billing_result: what was charged, for a pilot from day 61 | |
| Você recebe este e-mail porque é {perfil} no {conta}. ↵ Mudar notificações: {link} | `apps/web/lib/notify/templates.ts:30` | Footer of every notice e-mail | |
| Pedido de exclusão da conta | `apps/web/lib/portal/account-data.ts:60` | Deletion notice: subject | |
| {nome} pediu para excluir a conta {nome} e todos os dados. A exclusão acontece em até 90 dias. | `apps/web/lib/portal/account-data.ts:61` | Deletion notice: body | |
| Seu e-mail de login mudou | `apps/web/lib/portal/contact-change.ts:169` | Login e-mail changed: subject (to the old address) | |
| O e-mail de login de {nome} na MargoAI mudou para {e-mail}. Se não foi você, avise a MargoAI agora. | `apps/web/lib/portal/contact-change.ts:170` | Login e-mail changed: body | |
| {nome} aceitou o convite e entrou como {perfil}. | `apps/web/lib/portal/entry.ts:194` | security_event after an invite is accepted: subject and body | |
| Seu código de acesso à MargoAI: | `supabase/templates/codigo.html:1` | Login code e-mail (Supabase template) | |
| Ele vale por 10 minutos. Se não foi você que pediu, pode ignorar este e-mail. | `supabase/templates/codigo.html:3` | Login code e-mail (Supabase template) | |

## WhatsApp

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| MargoAI: seu fechamento de {mês} está pronto. Vendido {valor}, recebido {valor}, cobrado errado {valor}. O PDF está no seu portal. | `apps/web/emails/E01-fechamento.ts:63` | E01 WhatsApp version | |
| MargoAI: achamos {valor} cobrados errado no {canal} ({loja}). O texto para contestar está no seu portal. | `apps/web/emails/notices.ts:26` | new_difference WhatsApp | |
| MargoAI: o {canal} devolveu {valor} ({o quê}), no repasse de {data}. | `apps/web/emails/notices.ts:47` | credit_confirmed WhatsApp | |
| MargoAI: a autorização do iFood da {loja} foi retirada. Para voltar, permita a MargoAI no Portal do Parceiro, em Aplicativos. | `apps/web/emails/notices.ts:69` | data_stale (revoked) WhatsApp | |
| MargoAI: a extensão não manda dados da {loja} há {dias}. Abra o Portal do Parceiro no computador e toque em Exportar e enviar. | `apps/web/emails/notices.ts:80` | data_stale (extension) WhatsApp | |
| MargoAI: faltam notas de compra de {insumos}. Pode mandar a foto do QR da nota aqui. | `apps/web/emails/notices.ts:98` | invoices_missing WhatsApp | |
| MargoAI: na semana de {semana} você vendeu {valor} e recebeu {valor}. | `apps/web/emails/notices.ts:130` | weekly_summary WhatsApp | |
| MargoAI: seu teste grátis acaba {quando} ({data}). Para continuar com o fechamento, escolha um plano no portal. | `apps/web/emails/notices.ts:150` | trial_ending WhatsApp | |
| MargoAI: cobrança de {valor} aprovada. | `apps/web/emails/notices.ts:170` | billing_result approved WhatsApp | |
| MargoAI: o cartão recusou a cobrança de {valor}. Troque o cartão em Plano e cobrança. | `apps/web/emails/notices.ts:180` | billing_result refused WhatsApp | |
| MargoAI: {nome} entrou na sua conta. | `apps/web/emails/notices.ts:201` | security_event (new person) WhatsApp | |
| MargoAI: {nome} entrou por um aparelho novo. | `apps/web/emails/notices.ts:213` | security_event (new device) WhatsApp | |
| MargoAI: seu teste grátis acaba {quando}. Escolha um plano em {link}. Sem plano, a conta volta para o grátis e nada é cobrado. | `apps/web/lib/billing/service.ts:102` | trial_ending WhatsApp (plain text path) | |
| Oi! Falta 1 item para fechar o custo do cardápio: {insumo}. | `apps/web/lib/m3/P05-whatsapp-nota.ts:8` | P05 request with 1 missing item (drawn: "Faltam 4 itens") | |
| Agora não falta nenhum. | `apps/web/lib/m3/P05-whatsapp-nota.ts:14` | P05 reply after a QR is read, 0 or 1 missing left | |
| Agora falta 1. | `apps/web/lib/m3/P05-whatsapp-nota.ts:14` | P05 reply after a QR is read, 0 or 1 missing left | |
| Alerta urgente na MargoAI: {título}. | `apps/web/lib/notify/alerts.ts:60` | Urgent alert to the founder on duty | |
| Tem 1 item que dá para subir hoje sem risco. | `apps/web/lib/xray/P02-whatsapp-raio-x.ts:15` | P02 with 1 item to raise (drawn: plural) | |

## Extension popup (P04)

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| não encontrado | `apps/web/app/api/extension/request.ts:13` | Extension endpoints with the flag off (plain 404 text) | |
| Arquivo grande demais (até 20 MB). | `apps/web/lib/extension/core.ts:78` | Upload over 20 MB | |
| O arquivo precisa ser .csv ou .xlsx, como o Portal do Parceiro exporta. | `apps/web/lib/extension/core.ts:79` | Upload not .csv or .xlsx | |
| Escolha o arquivo que você baixou do Portal do Parceiro. | `apps/web/lib/extension/core.ts:80` | Upload without a file | |
| Sem autorização do dono para este CNPJ. A importação espera a autorização assinada. | `apps/web/lib/extension/core.ts:81` | CNPJ without owner authorization | |
| Extensão desligada para esta conta. | `apps/web/lib/extension/core.ts:82` | Extension flag off | |
| Extensão não conectada. Gere um código novo no portal. | `apps/web/lib/extension/core.ts:83` | Token unknown or revoked | |
| Código inválido ou vencido. Gere um código novo no portal. | `apps/web/lib/extension/core.ts:84` | Pairing code wrong or expired | |
| Loja não encontrada nesta conta. | `apps/web/lib/extension/core.ts:85` | Store not in the account | |
| As importações desta conta estão pausadas. Escolha um plano no portal da MargoAI para voltar. | `apps/web/lib/extension/core.ts:87` | Account without plan (imports paused) | |
| Sem conexão com a MargoAI. Tente de novo em instantes. | `extension/src/api.ts:31` | No network | |
| A extensão está desligada para esta conta. Fale com a MargoAI. | `extension/src/api.ts:32` | Extension off for the account | |
| Conecte a extensão com o código do portal. | `extension/src/api.ts:33` | Popup not paired | |
| Arquivo enviado. A MargoAI importa em alguns minutos. | `extension/src/api.ts:34` | After a send | |
| Exportando no Portal do Parceiro... | `extension/src/api.ts:35` | While clicking Export on the portal | |
| Não achei o botão Exportar nesta página. Escolha o arquivo que você exportou. | `extension/src/api.ts:36` | Export button not found: manual pick | |
| O portal não entregou o arquivo. Exporte você mesmo e clique de novo para escolher o arquivo. | `extension/src/api.ts:37` | Export clicked, no file arrived | |
| Exportar relatório | `extension/src/config.ts:27` | Button text the extension looks for on the portal (not shown, must match iFood) | |
| não conectada | `extension/src/popup.ts:31` | Status pill before pairing | |
| Código que o portal mostrou | `extension/src/popup.ts:38` | Pairing field label | |
| Para conectar, abra o portal da MargoAI no computador, em Conectar os apps, e digite aqui o código. | `extension/src/popup.ts:53` | Pairing note | |
| Abra o Portal do Parceiro nesta aba para mandar os relatórios. | `extension/src/popup.ts:70` | Popup opened on another page | |
| Arquivo exportado do Portal do Parceiro | `extension/src/popup.ts:88` | Accessible name of the file picker | |
| último envio: ainda não enviou | `extension/src/view.ts:8` | Last-send line before the first send | |

## PDFs and files

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Dados da conta {nome} (código {código}) na MargoAI. | `workers/account/src/margo_account/export.py:62` | Export LEIA-ME.txt, line 1 | |
| dados/: {n} tabelas em CSV, uma por arquivo, com a primeira linha de títulos. | `workers/account/src/margo_account/export.py:64` | LEIA-ME.txt | |
| arquivos/: {n} arquivos enviados ou gerados (extratos, fechamentos, PDFs). | `workers/account/src/margo_account/export.py:65` | LEIA-ME.txt | |
| Valores em centavos (colunas terminadas em _cents). Datas no horário de São Paulo. | `workers/account/src/margo_account/export.py:66` | LEIA-ME.txt | |
| {n} arquivos citados nos dados não estavam mais guardados. | `workers/account/src/margo_account/export.py:69` | LEIA-ME.txt when stored files were missing | |
| SINTÉTICO: dados fictícios de teste. | `workers/account/src/margo_account/export.py:71` | LEIA-ME.txt of a synthetic account | |
| um preço | `workers/render/src/margo_render/P01_raio_x.py:40` | P01 count word, 1 price (drawn: "três preços") | |
| {item} está acima da vizinhança. | `workers/render/src/margo_render/P01_raio_x.py:378` | P01 "Não mexa" block with one item (drawn: plural) | |
| {item} ({diferença} sem promoção) | `workers/render/src/margo_render/P01_raio_x.py:130` | P01 "Não mexa" block: an item there only because of its full-price gap (M1-07) | |
| O raio-X completo | `workers/render/src/margo_render/P01_raio_x.py:403` | P01 page 2 title | |
| sem promoção: {paridade}, {diferença} | `workers/render/src/margo_render/P01_raio_x.py:143` | P01 list, small line under a row: parity and gap at full prices, when the parity or the gap differs from the current one (M1-05) | |
| pode subir quando os vizinhos não estão em promoção | `workers/render/src/margo_render/P01_raio_x.py:145` | P01 list, small line under a `na_media` row with room at full prices (M1-07) | |
| Fora da conta, sem pares confiáveis: {itens}. | `workers/render/src/margo_render/P01_raio_x.py:434` | P01 last page footnote: skipped items | |
| arquivo do iFood | `workers/render/src/margo_render/close_job.py:25` | P06 "Fontes": iFood file source | |
| Nada cobrado errado neste mês. | `workers/render/src/margo_render/templates/P06-fechamento.json:17` | P06 when no difference | |
| falta custo | `workers/render/src/margo_render/templates/P06-fechamento.json:19` | P06 cost cells without cost | |
| Sem notas de compra ainda. O lucro por item entra quando o custo dos insumos chegar. | `workers/render/src/margo_render/templates/P06-fechamento.json:20` | P06 cost section without invoices | |
| menos da metade dos | `workers/render/src/margo_render/templates/P06-fechamento.json:34` | P06 decision sentence variant (drawn: "mais da metade") | |
| {item} deixa só {sobra} por pedido no {canal}, a menor sobra entre os itens que mais vendem. Vale rever o preço? | `workers/render/src/margo_render/templates/P06-fechamento.json:38` | P06 decision box, DLV-01 second branch | |

## Flags (C20 descriptions)

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Importar arquivo exportado do Portal do Parceiro iFood | `supabase/migrations/20261031000003_reference_data.sql:17` | C20 description of m2.arquivo_ifood | |
| Código de login pelo WhatsApp | `supabase/migrations/20261031000003_reference_data.sql:27` | C20 description of auth.whatsapp_code | |
| Ficha técnica, custo e sobra por item | `supabase/migrations/20261211000001_m3_custo_flag.sql:6` | C20 description of m3.custo | |
| Raio-X de loja concorrente | `supabase/migrations/20261212000001_competitor_xray_limit.sql:24` | C20 description of m1.concorrente | |
| Extração de lojas e cardápios por serviço externo | `supabase/migrations/20261220000001_extract_schema.sql` | C20 description of m1.extracao | |

## Browser tab titles

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| Conectar os apps · MargoAI | `apps/web/app/app/conectar/page.tsx:16` | Browser tab on /app/conectar | |
| Contestações · MargoAI | `apps/web/app/app/contestacoes/page.tsx:10` | Browser tab on /app/contestacoes | |
| Lojas · MargoAI | `apps/web/app/app/lojas/page.tsx:14` | Browser tab on /app/lojas | |
| Exemplo de e-mail · MargoAI | `apps/web/app/app/notificacoes/exemplo/page.tsx:13` | Browser tab on /app/notificacoes/exemplo | |
| Notificações · MargoAI | `apps/web/app/app/notificacoes/page.tsx:11` | Browser tab on /app/notificacoes | |
| Início · MargoAI | `apps/web/app/app/page.tsx:21` | Browser tab on /app | |
| Pessoas e acessos · MargoAI | `apps/web/app/app/pessoas/page.tsx:15` | Browser tab on /app/pessoas | |
| Plano e cobrança · MargoAI | `apps/web/app/app/plano/page.tsx:8` | Browser tab on /app/plano | |
| Segurança e acesso · MargoAI | `apps/web/app/app/seguranca/page.tsx:18` | Browser tab on /app/seguranca | |
| Alertas · MargoAI | `apps/web/app/console/(app)/alertas/page.tsx:12` | Browser tab on /console/alertas | |
| Configurações · MargoAI | `apps/web/app/console/(app)/config/page.tsx:8` | Browser tab on /console/config | |
| Contestação · MargoAI | `apps/web/app/console/(app)/contas/[code]/contestacoes/page.tsx:13` | Browser tab on /console/contas/[code]/contestacoes | |
| Contribuição · MargoAI | `apps/web/app/console/(app)/contas/[code]/contribuicao/[yyyy-mm]/page.tsx:24` | Browser tab on /console/contas/[code]/contribuicao/[yyyy-mm] | |
| De-para de insumos · MargoAI | `apps/web/app/console/(app)/contas/[code]/de-para/page.tsx:13` | Browser tab on /console/contas/[code]/de-para | |
| Estrutura do cliente · MargoAI | `apps/web/app/console/(app)/contas/[code]/estrutura/page.tsx:10` | Browser tab on /console/contas/[code]/estrutura | |
| Extensão do Chrome · MargoAI | `apps/web/app/console/(app)/contas/[code]/extensao/page.tsx:16` | Browser tab on /console/contas/[code]/extensao | |
| Diferenças no repasse · MargoAI | `apps/web/app/console/(app)/contas/[code]/fechamento/[yyyy-mm]/diferencas/page.tsx:14` | Browser tab on /console/contas/[code]/fechamento/[yyyy-mm]/diferencas | |
| Ficha técnica · MargoAI | `apps/web/app/console/(app)/contas/[code]/fichas/page.tsx:30` | Browser tab on /console/contas/[code]/fichas | |
| Conectar e importar · MargoAI | `apps/web/app/console/(app)/contas/[code]/importacoes/page.tsx:16` | Browser tab on /console/contas/[code]/importacoes | |
| Notas de compra · MargoAI | `apps/web/app/console/(app)/contas/[code]/notas/page.tsx:14` | Browser tab on /console/contas/[code]/notas | |
| E-mail que o dono recebe · MargoAI | `apps/web/app/console/(app)/emails/[code]/page.tsx:13` | Browser tab on /console/emails/[code] | |
| Corrigir importação · MargoAI | `apps/web/app/console/(app)/importacoes/[id]/corrigir/page.tsx:13` | Browser tab on /console/importacoes/[id]/corrigir | |
| Entrega ao dono · MargoAI | `apps/web/app/console/(app)/raio-x/[id]/entrega/page.tsx:18` | Browser tab on /console/raio-x/[id]/entrega | |
| Raio-X de preço · MargoAI | `apps/web/app/console/(app)/raio-x/[id]/page.tsx:15` | Browser tab on /console/raio-x/[id] | |
| Vizinhança · MargoAI | `apps/web/app/console/(app)/raio-x/[id]/vizinhanca/page.tsx:13` | Browser tab on /console/raio-x/[id]/vizinhanca | |
| Entrar no console · MargoAI | `apps/web/app/console/login/page.tsx:7` | Browser tab on /console/login | |
| Criar conta · MargoAI | `apps/web/app/criar-conta/page.tsx:9` | Browser tab on /criar-conta | |
| Escolher grupo · MargoAI | `apps/web/app/entrar/conta/page.tsx:9` | Browser tab on /entrar/conta | |
| Entrar · MargoAI | `apps/web/app/entrar/page.tsx:12` | Browser tab on /entrar | |
| Não consigo entrar · MargoAI | `apps/web/app/nao-consigo-entrar/page.tsx:5` | Browser tab on /nao-consigo-entrar | |
| Termos e privacidade · MargoAI | `apps/web/app/termos/page.tsx:5` | Browser tab on /termos | |

## Matched in another drawing

Listed as written without a drawing in `docs/build-review.md`, but the same words appear in some drawing, so they are not in the tables above. Check that the drawn use fits:

- `contra os` (P06 sentence, `workers/render/src/margo_render/templates/P06-fechamento.json`): found only in C04, in another sentence.
- `Foi negada` (C16 button): drawn on P12 and W03, not on C16.
- `equipe` (C16 owner label): drawn on C14, C21, P13, P17.
- `Importar` (C07 button): drawn on C07 and C20.
- `escolher` (C17): drawn on P08, P09, W01, W02, W04.
- `resolver` (C21), `vincular` (C19), `sem preço` and `cupom de dd/mmm` (C12), `Fontes` and `Sobra por pedido` (P06, xlsx sheet), `Sobrou depois dos insumos` (E01 with m3.custo off): drawn as words, on screens where they fit.
- `Insumo novo no catálogo` (C11): drawn on C11.

## Counts

| Section | Strings |
|---|---|
| C00 Login do console | 5 |
| C01 Clientes | 1 |
| C02 Novo raio-X | 7 |
| C03 Vizinhança | 29 |
| C04 Pareamento | 14 |
| C05 Raio-X de preço | 10 |
| C06 Entrega ao dono | 4 |
| C07 Conectar e importar | 30 |
| C08 Fechamento | 3 |
| C09 Diferenças no repasse | 8 |
| C10 Notas de compra | 23 |
| C11 De-para de insumos | 18 |
| C12 Ficha técnica | 13 |
| C13 Contribuição | 4 |
| C14 Configurações | 2 |
| C15 Assinaturas | 24 |
| C16 Contestação | 8 |
| C17 Corrigir importação | 18 |
| C18 Parceiros BPO | 10 |
| C19 Estrutura do cliente | 2 |
| C20 Funcionalidades | 7 |
| C21 Alertas | 27 |
| P07 Criar conta | 7 |
| P11 Termos e privacidade | 1 |
| P17 Não consigo entrar | 5 |
| P18 Aceitar convite | 7 |
| W01 / P08 Início | 4 |
| W02 / P13 Lojas | 4 |
| W03 / P12 Contestações | 1 |
| W04 / P14 Pessoas e acessos | 23 |
| W05 / P09 Plano e cobrança | 20 |
| W06 / P15 Entrar | 1 |
| W07 / P03 Conectar os apps | 7 |
| W08 / P16 Notificações | 3 |
| W09 Segurança e acesso | 16 |
| E-mails and notices | 65 |
| WhatsApp | 18 |
| Extension popup (P04) | 24 |
| PDFs and files | 19 |
| Flags (C20 descriptions) | 5 |
| Browser tab titles | 31 |
| **Total** | **528** |

## P19 to P24 / W10 to W15 Raio-X no portal (no drawing; prototype m1-owner-journey.html)

Strings the prototype does not have. The rest of these screens is the prototype's copy verbatim.

| Texto atual | Onde (path:line) | Quando aparece | Nova versão |
|---|---|---|---|
| primeiro raio-X a caminho | `apps/web/lib/monitor/view.ts:75` | P19 pill: a monitoring with no calculated run yet | |
| buscando a vizinhança | `apps/web/lib/monitor/view.ts:71` | P19 pill while the first run discovers | |
| leitura automática desligada | `apps/web/lib/monitor/view.ts:67` | P19 pill when m1.extracao is off (draft §2.3) | |
| Volta quando você assinar o Lucro. | `apps/web/app/app/raio-x/page.tsx:54` | P19 row paused by the plan | |
| Mudar frequência | `apps/web/app/app/raio-x/_components/MonitorMenu.tsx:2` | P19 row menu; opens a dialog "Com que frequência?" with Salvar / Cancelar | |
| Frequência salva. | `apps/web/app/app/raio-x/_components/MonitorMenu.tsx:102` | P19 after changing the period | |
| retomado. | `apps/web/app/app/raio-x/_components/MonitorMenu.tsx:52` | P19 toast "{loja}: retomado." (prototype adds the next reading date) | |
| O histórico continua guardado. | `apps/web/app/app/raio-x/_components/MonitorMenu.tsx:80` | P19 remove dialog: "Paramos de ler {loja}. O histórico continua guardado." (prototype adds "e aparece no seu raio-X") | |
| lojas suas | `apps/web/app/app/raio-x/_components/NovoForm.tsx:92` | P20 own-store limit reached: "Seu plano acompanha {uma loja sua | N lojas suas}." | |
| Esta loja é sua | `apps/web/app/app/raio-x/_components/NovoForm.tsx:123` | P20 pasted link of an own store: "Esta loja é sua: {loja}." | |
| Restam N novos este mês | `apps/web/app/app/raio-x/_components/NovoForm.tsx:70` | P20 cost line: "Conta como 1 dos {n} concorrentes do seu plano. {Resta 1 novo | Restam N novos} este mês." | |
| estimativa pelo ritmo dos últimos | `apps/web/app/app/raio-x/_components/Lendo.tsx:128` | P21 under the range: "estimativa pelo ritmo dos últimos {15} minutos" (prototype: "da última meia hora"; the window is 15 minutes) | |
| cardápios lidos, contando o | `apps/web/app/app/raio-x/_components/Lendo.tsx:122` | P21 big count: "... contando o {seu | dela}" ("dela" for a competitor) | |
| : lida | `apps/web/app/app/raio-x/_components/Lendo.tsx:168` | P21 pill for a competitor run: "{loja}: lida, N itens" / "{loja}: ainda não lida" | |
| o raio-X segue sem elas | `apps/web/app/app/raio-x/_components/Lendo.tsx:78` | P21 comparing: "Já dá para comparar com X de Y lojas. Não deu para ler N lojas; o raio-X segue sem elas. As que ainda estão sendo lidas entram no próximo raio-X." | |
| Não conseguimos ler o cardápio | `apps/web/app/app/raio-x/_components/Lendo.tsx:72` | P21 target failed, competitor variant "de {loja}" | |
| Itens conferidos. | `apps/web/lib/monitor/view.ts:131` | P21 step 3 once done | |
| Marcado por você | `apps/web/app/app/raio-x/_components/Revisar.tsx:94` | P22 when the owner changed the pre-marked suggestion | |
| use Desfazer | `apps/web/app/app/raio-x/_components/Revisar.tsx:170` | P22 all answered: "Dá para mudar a qualquer momento: use Desfazer." (prototype points to "Confirmados") | |
| não perguntamos as dúvidas | `apps/web/app/app/raio-x/_components/Revisar.tsx:176` | P22 competitor run while m1.portal_competitor_doubts_asked is 0 | |
| Revisar mesmo assim | `apps/web/app/app/raio-x/_components/Revisar.tsx:181` | P22 competitor run, collapsed doubts (draft Q4) | |
| Resposta desfeita. Recalculando o raio-X. | `apps/web/app/app/raio-x/_components/Revisar.tsx:62` | P22 toast after Desfazer | |
| : confirmado. | `apps/web/app/app/raio-x/_components/Revisar.tsx:97` | P22 toasts "{item}: confirmado." / "{item}: nenhum é o mesmo." / "{item}: salvo. Recalculando o raio-X." | |
| Desmarque as lojas | `apps/web/app/app/raio-x/_components/Revisar.tsx:309` | P22 "Não é o mesmo" on a system-confirmed item, with Salvar | |
| Não deu para ler a proteína no nome | `apps/web/lib/monitor/rules.ts:122` | P22 reason (M1-04 Stage 2 "proteína ilegível") | |
| supomos | `apps/web/lib/monitor/rules.ts:129` | P22 reason for "tamanho presumido {n} ml": "Não deu para ler o tamanho no nome; supomos {n} ml" | |
| Nenhum item está 10% ou mais abaixo | `apps/web/app/app/raio-x/_components/ResultView.tsx:319` | P23 headline when no item can go up | |
| Nenhuma cobra menos que | `apps/web/lib/monitor/view.ts:207` | P23 position when the store is the cheapest | |
| No raio-X anterior | `apps/web/lib/monitor/view.ts:216` | P23 change for periods other than weekly; also "Igual ao raio-X anterior." | |
| Comparado com | `apps/web/app/app/raio-x/_components/ResultView.tsx:281` | P23 banner when some stores were not read (draft §2.7) | |
| Preparando o PDF | `apps/web/app/app/raio-x/_components/ShareMenu.tsx:64` | P23 while worker-render prints: "Preparando o PDF. Leva até 1 minuto." | |
| Não conseguimos preparar o PDF | `apps/web/app/app/raio-x/_components/ShareMenu.tsx:64` | P23 when the print fails or takes over 3 minutes | |
| MargoAI · Raio-X de preço | `apps/web/app/app/raio-x/_components/ResultView.tsx:235` | PDF header (printed page only), with "SINTÉTICO" on synthetic accounts | |
| Itens só dele | `apps/web/app/app/raio-x/_components/ResultView.tsx:366` | P23 competitor view (prototype has it; listed for the wording "sem comparação") | |
| somamos um ponto | `apps/web/app/app/raio-x/[monitor]/historico/page.tsx:80` | P24 one run only (prototype: "Toda semana somamos um ponto") | |
| Itens comparados | `apps/web/app/app/raio-x/[monitor]/historico/page.tsx:245` | P24 runs table column, instead of the prototype's "Espaço para subir" (not in the history loader) | |
| sem número | `apps/web/app/app/raio-x/[monitor]/historico/page.tsx:139` | P24 table, a run before M1-12 v3 (or scored by an older formula) | |
| Cole o link da sua loja no iFood. | `apps/web/app/app/raio-x/_components/NovoForm.tsx` | P20 "Uma loja minha" option hint (D67; replaces "Escolha entre as suas lojas no iFood.") | |
| Link da sua loja no iFood | `apps/web/app/app/raio-x/_components/NovoForm.tsx` | P20 link field label when "Uma loja minha" is chosen (competitor keeps "Link da loja no iFood") | |
| Como fizemos este raio-X | `apps/web/app/app/raio-x/_components/ResultView.tsx` | P23 method in three steps (Marlon 08/nov, more didactic): "Lemos {n} lojas vizinhas" / "Num raio de {3} km, só o que está público no iFood em {dd/mmm}."; "Achamos {n} produtos iguais aos {seus | dele}" / "Mesmo produto, tamanho e sabor. Os itens só {seus | dele} ficam à parte."; "Olhamos o preço do meio" / "Para cada produto, metade das lojas cobra menos que o meio e metade cobra mais." | |
| Teste subir um item por vez | `apps/web/app/app/raio-x/_components/ResultView.tsx` | P23 legend: "Espaço para subir: 10% ou mais abaixo do meio. Teste subir um item por vez e acompanhe no próximo raio-X."; "Na média: Menos de 10% de diferença do meio. Nada a fazer agora."; "Não mexa sem saber o custo: 10% ou mais acima do meio. Antes de baixar, confira quanto custa fazer o item." (competitor: "Mais barato", "Na média", "Mais caro") | |
| Antes de mudar preços | `apps/web/app/app/raio-x/_components/ResultView.tsx` | P23 collapsed block, screen only (was "Como ler este raio-X" at the top; the method note keeps it) | |
| Itens alinhados | `apps/web/app/app/raio-x/_components/PriceScore.tsx` | M1-12 v3 label (Marlon, 07/nov) on P19 row, P23 card, P24 chart and tables; "{62}%"; P23 category chip "{62}% alinhados" | |
| estão na faixa de preço da vizinhança | `apps/web/app/app/raio-x/_components/PriceScore.tsx` | P23 card: "{n} de {m} itens comparados estão na faixa de preço da vizinhança, até 10% acima ou abaixo do meio." | |
| do meio, | `apps/web/app/app/raio-x/_components/PriceScore.tsx` | P23 card fact: "{n} {item abaixo | itens abaixo} do meio, {R$ x} de diferença por venda" | |
| Contamos quantos itens comparados | `apps/web/app/app/raio-x/_components/PriceScore.tsx` | P23 method: "Itens alinhados. Contamos quantos itens comparados {você vende | ele vende} na faixa de preço da vizinhança, até 10% acima ou abaixo do preço do meio. Itens abaixo e acima da faixa aparecem à parte. Não leva em conta custo nem volume de vendas. Categorias com menos de {5} itens comparados ficam sem número. A mudança desde o raio-X anterior compara os mesmos itens." | |
| Parte dos itens comparados na faixa | `apps/web/app/app/raio-x/_components/PriceScore.tsx` | P24 under the chart: "Parte dos itens comparados na faixa de preço da vizinhança, em cada raio-X. A mudança compara os mesmos itens do raio-X anterior." | |
| a categoria fica sem número | `apps/web/app/app/raio-x/_components/PriceScore.tsx` | P24 category: "Poucos itens: com menos de {5} itens comparados, a categoria fica sem número." | |
| raio-X desde | `apps/web/app/app/raio-x/[monitor]/historico/page.tsx:69` | P24 lead "{loja} · N raio-X desde dd/mmm." (prototype: "N raio-X semanais") | |
| Não conseguimos carregar agora. Seus acompanhamentos continuam rodando. | `apps/web/app/app/raio-x/error.tsx:7` | P19 to P24 read error (prototype P19 state), with "Tentar de novo" | |
| Raio-X · lojas que você acompanha | `apps/web/app/app/page.tsx:138` | P08 (phone) list entry to P19 while m1.portal is on (MenuDono shows no entries on the phone) | |
| Raio-X {n} desta loja | `apps/web/lib/monitor/view.ts:323` | P23 timeline title: n = this run among the monitoring's calculated runs (Marlon, 08/nov) | |
| Próximo em {seg 16/nov} | `apps/web/lib/monitor/view.ts:330` | P23 timeline and "Até o próximo raio-X": date of the next run of an active monitoring | |
| Acompanhamento pausado | `apps/web/lib/monitor/view.ts:329` | P23 timeline and "Até o próximo raio-X" when the monitoring is paused (by the person or the plan) | |
| Acompanhamento encerrado | `apps/web/lib/monitor/view.ts:328` | P23 timeline and "Até o próximo raio-X" when the monitoring was removed | |
| Posição | `apps/web/app/app/raio-x/_components/Timeline.tsx:85` | P23 timeline: second line of the chart, M1-10 position with "{4ª} de {9}" | |
| 1ª = mais barata. | `apps/web/app/app/raio-x/_components/Timeline.tsx:122` | P23 timeline under the chart, and after the item position line in "Seus testes" | |
| O histórico começa aqui. A cada raio-X somamos um ponto. | `apps/web/app/app/raio-x/_components/Timeline.tsx:123` | P23 timeline with a single calculated run | |
| Ver histórico | `apps/web/app/app/raio-x/_components/Timeline.tsx:126` | P23 timeline link and "Até o próximo raio-X" button, to P24 (screen only) | |
| Vou testar | `apps/web/app/app/raio-x/_components/TestButton.tsx:45` | P23 item button of an own-store run: marks the item to test until the next run | |
| Testando · Desfazer | `apps/web/app/app/raio-x/_components/TestButton.tsx:45` | P23 item button of a marked item, and in "Seus testes" | |
| Só quem responde as dúvidas desta loja escolhe os testes. | `apps/web/app/app/raio-x/_components/TestButton.tsx:30` | P23 "Vou testar" hint, disabled for Financeiro (and a Gerente of another kitchen) | |
| Você já está testando {3} itens. | `apps/web/app/app/raio-x/_components/TestButton.tsx:30` | P23 "Vou testar" hint, disabled when m1.test_max_items are marked | |
| Você já está testando {3} itens. Desfaça um para escolher outro. | `apps/web/lib/monitor/rules.ts:110` | P23 refusal monitor_test_limit:3 from the server | |
| Só dá para testar itens de uma loja sua. | `apps/web/lib/monitor/rules.ts:112` | P23 refusal monitor_test_own_only (competitor monitoring) | |
| Este item não está neste raio-X. | `apps/web/lib/monitor/rules.ts:114` | P23 refusal monitor_test_bad_item | |
| Seus testes | `apps/web/app/app/raio-x/_components/TestPlan.tsx:22` | P23 section of an own-store run with the items marked "Vou testar" | |
| Escolha até {3} itens para testar até o próximo raio-X. Mude o preço de um deles no iFood e veja aqui o que aconteceu. | `apps/web/app/app/raio-x/_components/TestPlan.tsx:41` | P23 "Seus testes" when nothing is marked (screen only) | |
| Marcado em {02/nov}: você {R$ 20,00}, meio {R$ 25,00}. | `apps/web/lib/monitor/view.ts:381` | P23 "Seus testes": own price and middle (M1-05) on the run where the item was marked | |
| Agora: você {R$ 24,00}, meio {R$ 24,50}, {na média} | `apps/web/lib/monitor/view.ts:385` | P23 "Seus testes": the run shown, with the M1-07 reading in words | |
| com espaço para subir / na média / não mexa sem saber o custo | `apps/web/lib/monitor/view.ts:369` | P23 "Seus testes": M1-07 reading words after "Agora:" | |
| O próximo raio-X mostra o que mudou. | `apps/web/lib/monitor/view.ts:382` | P23 "Seus testes": an item marked on the run shown | |
| Agora: o item não apareceu neste raio-X. | `apps/web/lib/monitor/view.ts:383` | P23 "Seus testes": the item is not in the run shown | |
| sem comparação neste raio-X | `apps/web/lib/monitor/view.ts:385` | P23 "Seus testes": the item is in the run shown without a price or middle | |
| Entre as lojas que vendem: era {5ª} de {9}, agora {3ª} de {9}. | `apps/web/lib/monitor/view.ts:391` | P23 "Seus testes": M1-10 position of the item, then and now | |
| Até o próximo raio-X | `apps/web/app/app/raio-x/_components/NextSteps.tsx:27` | P23 end of page, replacing the end point (prints) | |
| Nenhum item em teste. / {1} de {3} itens em teste. | `apps/web/lib/monitor/view.ts:396` | P23 "Até o próximo raio-X" (own-store runs), before the next run date | |
| Acompanhar um concorrente | `apps/web/app/app/raio-x/_components/NextSteps.tsx:33` | P23 "Até o próximo raio-X" button to P20, when the plan allows competitors (screen only) | |
| Oportunidades | `apps/web/app/app/raio-x/_components/Opportunities.tsx:25` | P23 eyebrow of the AI opportunities block (own run, m1.oportunidades_ia; Marlon 08/nov) | |
| Sugestão gerada por IA a partir dos números deste raio-X. Confira antes de mudar preços. | `apps/web/app/app/raio-x/_components/Opportunities.tsx:27` | P23 line under "Oportunidades" | |
| Subir preço | `apps/web/app/app/raio-x/_components/Opportunities.tsx:8` | P23 opportunity tag, lever subir_preco | |
| Manter | `apps/web/app/app/raio-x/_components/Opportunities.tsx:9` | P23 opportunity tag, lever manter | |
| Rever custo | `apps/web/app/app/raio-x/_components/Opportunities.tsx:10` | P23 opportunity tag, lever rever_custo | |
| Acompanhar | `apps/web/app/app/raio-x/_components/Opportunities.tsx:11` | P23 opportunity tag, lever acompanhar | |
| Itens | `apps/web/app/app/raio-x/_components/Opportunities.tsx:42` | Accessible name of the item names under an opportunity | |
| Oportunidades sugeridas por IA no resultado do raio-X | `supabase/migrations/20261231000007_m1_opportunities.sql:13` | C20 description of the flag m1.oportunidades_ia | |
| {título e porquê de cada oportunidade} | `workers/collector/src/margo_collector/opportunities.py` (SYSTEM) | P23 opportunity text, written by the AI from the run's numbers; kept only when every number exists in the facts, without "lucro", "margem", "ganho" or long dash | |

| No centro, a sua loja. Cada ponto é uma loja lida. | `apps/web/app/app/raio-x/_components/NeighborMap.tsx` | P23 radius map caption, own store (Marlon, 08/nov) | |
| No centro, a loja dele. Cada ponto é uma loja lida. | `apps/web/app/app/raio-x/_components/NeighborMap.tsx` | P23 radius map caption, competitor | |
| {N} km | `apps/web/app/app/raio-x/_components/NeighborMap.tsx` | P23 radius map, label on the circle | |
| Mapa do raio de {N} km: a sua loja no centro e {N} lojas lidas em volta. | `apps/web/app/app/raio-x/_components/NeighborMap.tsx` | Accessible name of the radius map | |
| Japonesa | `apps/web/lib/xray/labels.ts` | P20 and C02, cuisine option, D71 | |
| Chinesa e asiática | `apps/web/lib/xray/labels.ts` | P20 and C02, cuisine option, D71 | |
| Pizza | `apps/web/lib/xray/labels.ts` | P20 and C02, cuisine option, D71 | |
| Italiana | `apps/web/lib/xray/labels.ts` | P20 and C02, cuisine option, D71 | |
| Brasileira e marmita | `apps/web/lib/xray/labels.ts` | P20 and C02, cuisine option, D71 | |
| Carnes e frango | `apps/web/lib/xray/labels.ts` | P20 and C02, cuisine option, D71 | |
| Árabe | `apps/web/lib/xray/labels.ts` | P20 and C02, cuisine option, D71 | |
| Pastel e salgados | `apps/web/lib/xray/labels.ts` | P20 and C02, cuisine option, D71 | |
| Saudável e vegana | `apps/web/lib/xray/labels.ts` | P20 and C02, cuisine option, D71 | |
| Doces e sorvetes | `apps/web/lib/xray/labels.ts` | P20 and C02, cuisine option, D71 | |
| Padaria e café | `apps/web/lib/xray/labels.ts` | P20 and C02, cuisine option, D71 | |
| Escolha a cozinha | `apps/web/app/app/raio-x/_components/NovoForm.tsx` | P20 category field, empty option, D71 | |
| Escolha a cozinha da loja: ela define quem conta como concorrente. | `apps/web/app/app/raio-x/_components/NovoForm.tsx` | P20 hint when the catalog does not know the store, D71 | |
| revisar: revisão de IA incompleta | `workers/collector/src/margo_collector/pair_review.py` | C04 and doubts, an item whose pairs the AI could not finish reviewing, M1-12 | |
