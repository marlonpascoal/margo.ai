# Draft amendments to docs/decisions.md (review of 31/out)

Claude may not edit `docs/decisions.md` (CLAUDE.md rule 7). These are the decisions Marlon took in the build review of 31/out, written so they can be pasted into it. Delete this file once they are in.

| ID | Amends | Text |
|---|---|---|
| D47a | D47 | Live collection of public iFood pages was released before the legal consult, within D47's limits. iFood answered the first request with a 403; the collector stopped as D47 requires. Automatic collection is suspended until a new strategy is chosen (`docs/m1-extraction-brief.md`). The legal consult (D01b) still comes before the first X-ray delivered outside the test case |
| D49 | D29, D40 | The billing unit is the channel store, counting only stores of kitchens in analysis. G-SYN's Grupo Exemplo pays for 5 stores, R$ 1.500, not the drawn 6 and R$ 1.800 |
| D50 | 05, 06, P04 | The extension clicks the Partner Portal's Export button on the page the owner opened, and sends the file; the manual file pick stays as a fallback. Selectors are confirmed on the real portal before go-live |
| D51 | D14 | The AI matching prompt sends the line description, NCM, unit, supplier name (company issuers only; none for a CPF issuer) and unit price, plus catalog names |
| D52 | D14 | Ingredient rules are hybrid. A confirmation becomes a rule of that account and confirms automatically there. Globally it only suggests until `m3.global_rule_min_accounts` (3) accounts confirm it with no disagreement. Any disagreement demotes it and flags it for a founder. Two rules pointing to different ingredients send the line to review |
| D53 | 03, D11 | An invoice access key is unique per account, not globally, so no account learns that another holds an invoice |
| D54 | 04 §4 CTB-01 | Channel take is commission, payment fee and promotion, as written. The drawn values in C13, P06 and W01 no longer match. Coupons use the funding split recorded by M2 |
| D55 | plans | X-rays of competitor stores are allowed, limited per month by a plan field: Raio-X grátis 0, Lucro 3, Rede 10. They are gated by a flag |
| D56 | 04 M1 | M1-10 (price index ranking) is adopted. A store is ranked only when it shares at least `m1.rank_min_items` (3) items with the target. Rank 1 is the cheapest |
| D57 | D36 | Quiet hours (22h to 8h) hold for everyone, except urgent team alerts to the founder on duty by WhatsApp |
| D58 | 04 §8 | Each person changes their own login e-mail; nobody changes another person's (the Dono removes and invites again; P17 covers lost access). The 24-hour security lock after a change applies only to that person. A Gerente invite requires at least one kitchen |
| D59 | D40 (7) | A pilot converts to the plan price at day 61 unless a founder has set pilot terms in C15. A failed charge raises an alert and is never resent automatically. No notice before the first charge; the owner gets the billing result |
| D60 | 04 §6 | New flag `m3.custo` gates C12, C13, the contribution job and every "sobrou" (W01, the E01 e-mail and the close notice) |
| D61 | 02 §7 | Deletion 90 days after a client leaves is done by a founder from the console until go-live; no scheduled job yet. A cancelled subscription returns the account to Raio-X, pauses imports and keeps data |
| D62 | build | The rest of `docs/build-review.md` is accepted as built and parked for go-live, including the seed-only numbers, internal names, M2 confidence labels and copy written without a drawing. The C10 against C12 seed difference and the choice of one PDF library wait for real invoices and the visual direction |
