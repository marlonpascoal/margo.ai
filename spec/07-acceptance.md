# 07. Acceptance

There is no external rubric. "Done" is this table plus the screen checks in 05-screens. Each row names the test that proves it. A wave is accepted when all its rows pass in CI on the local stack and once on a Vercel preview with the dev Supabase project.

## 1. Golden cases (D46)

| Case | Data | Must reproduce |
|---|---|---|
| `G-SYN` | Seed, synthetic, labeled SINTÉTICO | Every number drawn in `design/` for Grupo Exemplo and Pantanos Burguer (September 2026 close, X-ray of 28/out) to the centavo |
| `G-REAL-1` | First real group, hand-calculated by Marlon and Manuel in E1 and E2, anonymized (store names to codes, CNPJs removed, values kept) before entering `fixtures/` | Payout differences (E1) and cost coverage (E2) exactly. **V1 is not done until this passes** |

## 2. Acceptance table

| # | Area | Criterion | Test |
|---|---|---|---|
| A01 | Base | Fresh clone: `pnpm i && supabase start && pnpm db:reset && pnpm test` passes on the Mac mini with no secret | `ci/local.sh` |
| A02 | Base | RLS: a person of account X cannot read any row of account Y through any endpoint | `tests/rls/*.sql` (pgTAP) plus e2e |
| A03 | Base | Gerente of kitchen K sees nothing of other kitchens (pages, PDFs, exports) | e2e `permissions.spec.ts` |
| A04 | Base | Every write by a person creates an `audit_log` row | unit, per server action |
| A05 | Base | Flag off hides the screen (404) and the job refuses to run | e2e `flags.spec.ts` |
| A06 | Base | No secret value in any HTTP response, log line or git file | `scripts/secret_scan.py` (keys, tokens, CNPJ and CPF patterns outside fixtures) |
| A07 | Jobs | A job runs once even when the webhook is delivered twice; unsigned webhook calls are rejected | `workers/common/tests/test_runner.py` |
| A08 | Jobs | Stuck job requeues once, then fails with an alert | same |
| B01 | M1 | X-ray of Pantanos Burguer from recorded public pages: neighborhood, exclusions, pairs, parity, gaps, Pareto as in the seed | `workers/collector/tests`, `apps/web` e2e C02 to C06 |
| B02 | M1 | Collector waits at least 3 s between requests and stops on a block | unit with a fake clock |
| B03 | M1 | P01 PDF renders A4 with the 3 items and the do-not-lower list | `workers/render/tests` (text extraction) |
| C01 | M2 | iFood export file and 99Food statement of G-SYN import to the canonical tables; re-import adds zero rows | `workers/import/tests` |
| C02 | M2 | Changed 99Food layout goes to `needs_mapping`; after mapping, totals match and the next file imports alone | e2e C17 |
| C03 | M2 | Close (C08) and differences (C09) of G-SYN September match the seed; each difference lists its orders | unit plus e2e |
| C04 | M2 | Contestation state machine: every transition in 04 §3 and no other | unit |
| C05 | M2 | iFood API adapter, replaying recorded test-environment responses, produces the same canonical rows as the file adapter for the same orders | `workers/import/tests/test_ifood_api.py` |
| C06 | M2 | Real file refused when the CNPJ has no `owner_authorization` | unit |
| D01 | M3 | XML zip: counts of NF-e, NFC-e, duplicates as in the seed; invalid key rejected | `workers/import/tests/test_invoices.py` |
| D02 | M3 | AI suggestion does not change any cost until confirmed | unit |
| D03 | M3 | Contribution and error bars of the top items match the seed | unit |
| E01 | Account | Sign-up to trial to Lucro checkout in the Asaas sandbox; webhook sets `active`; replayed webhook changes nothing | e2e on preview (Marlon runs) plus unit with recorded webhooks |
| E02 | Account | Trial end without plan returns the account to free and pauses imports | unit with a fake clock |
| E03 | Account | Login code rules (10 minutes, 5 tries, lock) and session lengths | unit plus e2e |
| E04 | Account | Last Dono cannot be removed or demoted; 24-hour lock after a contact change | unit |
| E05 | Account | Notifications: preferences respected, locked notices always by e-mail, quiet hours hold WhatsApp | unit |
| E06 | Account | Data export zip and deletion job (rows and files gone, receipt in audit log) | unit |
| F01 | Screens | Every `design/*.dc.html` has an entry in 05-screens and a route or template in the code | `scripts/check_screens.py` |
| F02 | Screens | Visual check: each built page next to its drawing at 390 px and 1280 px wide, screenshots saved to `artifacts/screens/` for Marlon to compare | `pnpm e2e:screens` |
| G01 | Done | `G-REAL-1` reproduced | `tests/golden/test_real_1.py` (runs only where the anonymized fixture exists) |

## 3. What is checked by a person

- F02 screenshots against the drawings: Marlon or Manuel, at the end of each wave.
- First live calls to the iFood test environment and the Asaas sandbox: Marlon at the keyboard (D40, D44).
- Legal drafts in `docs/legal/`: a lawyer, before the first real file (D48).
