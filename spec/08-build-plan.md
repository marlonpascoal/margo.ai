# 08. Build plan

How the build runs (D02): Claude Code in VS Code on the Mac mini, permissions file auto-accepting edits and build commands, risky commands blocked (`.claude/settings.json`). Marlon watches live. Claude pushes to GitHub (fast-forward only, authorized by Marlon on 31/out); Vercel builds previews from branches and production from `main`.

## 1. Session protocol (every task)

1. Read `CLAUDE.md`, then the spec files named in the task.
2. Write or extend tests first (acceptance row IDs in the test names, e.g. `test_C04_contestation_transitions`).
3. Implement until the tests pass on the local stack.
4. Run `pnpm check` (lint, types, unit, `check_screens`, `secret_scan`).
5. Stop and summarize: what changed, which acceptance rows now pass, anything that needs Marlon (live call, decision).
6. Never: read secrets, call preview or production services, force push or rewrite history, change `docs/decisions.md`. If the spec is ambiguous or contradicts a decision, stop and ask.

## 2. Waves (D45)

Dates assume the build starts on 31/out. E4 deliveries start 16/nov.

### Wave 0. Base (31/out to 3/nov)

| Task | Spec | Acceptance |
|---|---|---|
| Monorepo (pnpm workspaces, uv for workers), CI script, `check_screens`, `secret_scan` | 02 §2 | A01, A06, F01 |
| Schema and RLS for entities, people, staff, flags, audit, job, notification, alert | 03 §1, §5 | A02, A04 |
| Seed `G-SYN` | 03 §6 | |
| Auth: e-mail code for console and portal, sessions, devices | 04 §8 | E03 |
| Feature flags (OpenFeature provider over our tables), C20 | 04 §6 | A05 |
| Job queue, `Runner` (local implementation), signed wake-up | 02 §4 | A07, A08 |
| Notifier with dev inbox; alerts and C21 | 04 §9, §10 | E05 (partial) |
| Design tokens, app shells (console sidebar, owner menu), C00, C01, C14 | 02 §9, 05 | |

### Wave 1. Two lanes in parallel (4/nov to 13/nov)

Run as two Claude Code sessions in two git worktrees (`../margo.ai-m1`, `../margo.ai-m2`), each in its own VS Code window, merged by Marlon.

| Lane A: M1 | Lane B: M2 from files |
|---|---|
| worker-collector with rate limit and stop-on-block (D47); recorded public pages as fixtures | worker-import: iFood export file parser, 99Food parser, column mapping |
| Pairing, normalization, parity, Pareto (M1-01 to M1-09) | Canonical tables, dedupe, import history |
| C02, C03, C04, C05, C06 | C07, C17, C19, C08, C09, C16 |
| worker-render: P01 PDF | REP and DIF rules, contestation state machine; P06 PDF without cost (M3 section shows "falta custo") |
| B01, B02, B03 | C01, C02, C03, C04, C06 |

**Spike, as soon as the iFood developer account exists (Marlon live):** token, merchant list, test orders, financial endpoints, record fixtures (06 §1). Then the API adapter joins lane B (C05).

**13/nov:** both lanes merged; first deploy to a Vercel preview with the dev Supabase project and Maritime dev agents; Marlon runs the G-SYN flow end to end. **14/nov to 15/nov:** prod Supabase project, Maritime prod agents, production deploy behind founders-only access (console only; owner portal not public yet). **16/nov:** E4 deliveries use the console with real files (authorization signed first).

### Wave 2. Owner side and billing (17/nov to 30/nov)

| Task | Spec | Acceptance |
|---|---|---|
| Owner portal: P15/W06, P07, P17, P18, P08/W01, P13/W02, P12/W03, P14/W04, P16/W08, W09, P11 | 05 §B | A03, E03, E04, E05, E06 |
| Asaas: plans, checkout, webhooks, trial end, P09/W05, C15, pilots | 04 §7, 06 §4 | E01, E02 |
| P03/W07 authorization flow and `owner_authorization` | 05, 06 §1 | C06 |
| Chrome extension (P04), pairing, upload endpoint | 06 §9 | |
| E-mail templates E01, E02 and the rest; WhatsApp manual queue | 04 §9 | |
| C18 BPO branding | 05 | |

### Wave 3. Cost and contribution (December)

| Task | Spec | Acceptance |
|---|---|---|
| Invoice import (zip, key, QR link), C10 | 06 §5 | D01 |
| worker-match with the AI API (D70), C11 | 06 §6 | D02 |
| Recipes, C12, error bars | 04 §4 | |
| Contribution, C13, full P06 with "one decision for the month" | 04 §4 | D03 |
| iFood homologation preparation: app complete, form answered from the test environment | 06 §1 | |
| `G-REAL-1` golden case | 07 §1 | G01 |

## 3. Before go-live for owners (checklist)

- [ ] Lawyer reviewed `docs/legal/` (D48); legal consult on public collection and the extension (D01b).
- [ ] Trial length and plan prices set in C15 (open item).
- [ ] Billing unit confirmed: kitchen or channel store (open item).
- [ ] E-mail provider chosen; domain verified with SPF, DKIM, DMARC (open item).
- [ ] WhatsApp Business Platform decision (open item); until then WhatsApp stays manual and login codes by e-mail.
- [ ] Visual direction chosen; `tokens.css` replaced (open item).
- [ ] Pilot percentage and cap per account (open item).
- [ ] iFood homologation passed and production app created, or owners stay on file imports.
- [ ] Maritime data processing agreement signed; Supabase and Vercel DPAs accepted.
- [ ] Restore test of the prod database backup done once.
