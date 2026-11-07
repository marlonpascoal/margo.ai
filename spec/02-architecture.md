# 02. Architecture

Decisions: D41 (hosting), D42 (Maritime), D43 (stack), D44 (secrets), D34 (flags), D36 (notifications).

## 1. The pieces

```
                 owner phone / computer          founders
                         |                          |
                         v                          v
   Chrome extension -> [ Vercel: Next.js app  /app  /console  /api ] <- Asaas webhooks
   (computer only)               |        |                 |
                                 |        | signed webhook  | e-mail / WhatsApp link
                                 v        v                 v
                     [ Supabase (São Paulo) ]      [ Maritime agents (US or DE) ]
                       Postgres + RLS                worker-import
                       Auth (codes)                  worker-collector (M1)
                       Storage (files, PDFs)         worker-match (Claude API)
                       job queue table               worker-render (PDF, xlsx)
                                 ^                          |
                                 +---- read job / write ----+
                                          results
   External: iFood Merchant API (test env first), Asaas, e-mail provider, Anthropic API
```

| Piece | Runs | Responsibility |
|---|---|---|
| `apps/web` | Vercel, functions in `gru1` (São Paulo) | Owner portal, console, REST endpoints for the extension, Asaas webhooks, enqueue jobs, send notifications, Vercel Cron for light schedules |
| `supabase/` | Supabase project in `sa-east-1` | Schema and migrations, RLS policies, Auth (e-mail OTP; WhatsApp OTP through the notifier), Storage buckets, `job` queue table |
| `workers/` | Maritime, one agent per job type | Long or heavy jobs. Stateless containers (D42) |
| `extension/` | Owner's Chrome | Reads the page the owner opened in the iFood Partner Portal, clicks Export, uploads the file to `/api/ext/upload` |
| `packages/contracts` | Shared | Generated DB types (TS), Pydantic models (Python), JSON schemas for job payloads |

## 2. Repository layout

```
margoai/
  CLAUDE.md
  .claude/settings.json
  docs/                 decisions.md, legal/, runbook.md
  design/               the screen files (*.dc.html) and canvas.json, read-only reference
  spec/                 this spec
  apps/web/             Next.js (App Router), Tailwind, tokens in app/tokens.css
  extension/            Chrome MV3, TypeScript
  workers/
    common/             job runner, Runner interface, Supabase client, signing
    import/             ifood_api, ifood_file, food99_file, column-mapping
    collector/          M1 rules and X-ray steps; pages are read by an external extractor (06 §10)
    match/              de-para suggestions (Claude API)
    render/             PDF (weasyprint) and xlsx (openpyxl)
  supabase/
    migrations/         SQL, the contract
    seed/               G-SYN synthetic group (labeled SINTÉTICO)
  packages/contracts/
  fixtures/             recorded iFood test-environment responses, synthetic files
```

## 3. Environments

| Env | Web | Database | Workers | External |
|---|---|---|---|---|
| local | `next dev` on the Mac mini | Supabase local stack (`supabase start`) | run as plain Python processes | none: tests replay recorded fixtures |
| preview | Vercel preview per branch | Supabase **dev** project | Maritime dev agents | Asaas sandbox, iFood test app |
| production | Vercel production | Supabase **prod** project | Maritime prod agents | Asaas production, iFood production app (after homologation) |

Build agents (Claude Code) work only in **local**. They never hold preview or production credentials (D44, D20).

## 4. Jobs: queue, wake-up, idempotency

Table `job` (see data model) is the single queue for imports, collection, matching and rendering.

1. The web app inserts a `job` row (`status=queued`, `type`, `payload`, `account_id`, `dedupe_key`).
2. It calls the worker's Maritime webhook `POST https://api.maritime.sh/api/webhooks/{agent_id}` with body `{job_id, ts, sig}`, where `sig = HMAC-SHA256(MARITIME_WEBHOOK_SIGNING_KEY, job_id|ts)`. Maritime's URL is the only credential it asks for, so the signature is mandatory; workers reject unsigned or older-than-5-minutes calls.
3. Schedules (daily iFood pull at 06:00 São Paulo, weekly summary, trial reminders) are Maritime cron triggers on the relevant worker, or Vercel Cron when the work is a quick database update.
4. The worker claims the job with `UPDATE job SET status='running', claimed_at=now() WHERE id=? AND status='queued'` (one winner), does the work, writes results and `status=done|failed` with a log.
5. A job stuck in `running` for more than 30 minutes returns to `queued` once, then fails and raises an alert (C21).
   `extract_discover` and `extract_capture` are claimed over HTTPS by an external extractor (06 §10) instead of a worker; the same claim, flag and stuck rules apply, one at a time.
6. Every import row has a natural key; re-importing the same period never double-counts (D31).

The `Runner` interface in `workers/common` hides Maritime: `Runner.enqueue(job)` and `Runner.on_job(handler)`. Swapping the host means a new `Runner`, not new job code (D42).

## 5. Auth and authorization

- Supabase Auth with passwordless codes. E-mail codes go through Supabase Auth's e-mail OTP using our e-mail provider; WhatsApp codes are generated by our `/api/auth/whatsapp` route and delivered by the notifier (manual click-to-chat until the WhatsApp Business Platform, D36). Code: 6 digits, 10 minutes, 5 attempts, then 15-minute lock.
- Every table carries `account_id`. RLS policies check `membership(account_id, person_id, role, scope)` for portal users and `staff(person_id, role)` for console users. RLS is on for every table and grants SELECT only; `authenticated` holds SELECT and nothing else, `anon` holds no table access (the anon key only opens Supabase Auth; pages before login read on the server).
- Permissions live in the application layer; RLS is the second lock (D63). Permission checks live in one module per app (`apps/web/lib/permissions.ts`) and mirror the matrix in `04-rules.md` section 5. UI hiding is not security; every server action re-checks.
- **Owner portal reads** go through `Member.db`, handed out by `requireMember()` and `requirePortal()`: the `ReadDb` interface in `apps/web/lib/supabase/reader.ts`, read-only, using the person's session so RLS applies, and filtered to the opened account (a person of two accounts, or a staff person who is also a member, reads only the one opened). Changing the mechanism touches `reader.ts` and `sessionReader()` in `lib/supabase/server.ts`. Lint refuses `adminClient` in portal pages, routes and `lib/portal`, except with an inline reason.
- **Portal reads that stay on the service role**, because RLS rightly refuses the whole row and the page needs one value, are listed in `apps/web/lib/portal/admin-reads.ts`; private Storage buckets and service-role functions (`people_lock_until`, `flag_enabled`) also stay there, after the row or permission check.
- **Writes** by a person go through audited server actions and functions with the service role, each re-checking permissions.
- **The console** uses the service role only inside server functions that already checked `staff.role`. Workers connect with their own credentials, and extension routes authenticate with the extension token.
- Every write by a person writes an `audit_log` row (who, what, before, after, when, ip, user agent).

## 6. Secrets (D44)

| Secret | Where | Who can read it |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` (per env) | Vercel env, Maritime env | Platforms only |
| `IFOOD_CLIENT_ID`, `IFOOD_CLIENT_SECRET` (test app, later prod app) | Vercel env, Maritime env | Platforms only |
| `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN` | Vercel env | Platforms only |
| `ANTHROPIC_API_KEY` | Maritime env (worker-match) | Platforms only |
| `MARITIME_WEBHOOK_SIGNING_KEY` | Vercel env, Maritime env | Platforms only |
| `EMAIL_PROVIDER_KEY` | Vercel env | Platforms only |
| `MARGO_EXTRACT_TOKEN` | Vercel env; the extractor's own configuration (D47b) | Platforms and the extractor |

Rules: nothing in git; no `.env` with a real value; secrets never logged (logger redacts keys matching `/key|secret|token|authorization/i`); C14 shows only "set / missing" per secret.

## 7. Data location and LGPD (D41, D42, D48)

- Database and files: Supabase São Paulo. Web functions: São Paulo.
- Processing in workers: Maritime, United States or Germany. Workers keep nothing after a job (`/data` wiped), and logs carry ids, never restaurant names or values.
- The owner authorization and terms state the international processing.
- Deletion: on request or 90 days after a client leaves, a scheduled job deletes the account's rows and files and writes a deletion receipt to `audit_log`.

## 8. Observability

- One JSON log line per external call (service, endpoint, status, duration, job id), secrets redacted.
- Team alerts (C21) are rows in `alert`, created by jobs and webhooks; the notifier e-mails the team and, for `urgente`, WhatsApps the founder on duty.
- Uptime: a Vercel Cron pings each worker's health route every hour; two misses raise an `urgente` alert.

## 9. Design tokens (D40)

`apps/web/app/tokens.css` defines color, type, spacing and radius variables. The neutral theme matches the wireframes in `design/`. The visual direction, when chosen, replaces this file only. Components use tokens, never raw hex values. PDFs use the same tokens through `workers/render/tokens.py`, generated from the CSS file.
