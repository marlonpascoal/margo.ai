# First Vercel preview: what Marlon does

The goal: the web app on a Vercel preview, on a Supabase **dev** project loaded with the G-SYN seed, open to founders only (02 §3, 08 "13/nov"). Marlon runs every step: build agents never hold these keys or touch hosted databases (CLAUDE.md rules 1 and 2, D44).

What works there: login, the console and the owner portal on G-SYN's synthetic data. What does not work yet:

- **Notice e-mails:** no provider is chosen yet (D36). Login codes still work, through Supabase's SMTP.
- **Workers:** collection, imports, AI matching and PDFs need Maritime; queued jobs wait.
- **Payments:** need the Asaas sandbox key (step 6).

## 1. Supabase dev project

1. In supabase.com, create a project named `margoai-dev`, region **South America (São Paulo)**. Keep the database password in your password manager.
2. Push the schema and the seed from the repo root. This is the only time you run `link`, on your terminal, never in a Claude session:

   ```sh
   supabase link --project-ref <dev project ref>
   supabase db push --include-seed
   ```

   If the CLI asks about out-of-order migrations, add `--include-all`.
3. **Logins.** The seed's fictional people use `exemplo.com.br`, a real domain. To move them to your own inbox:
   1. Open the Supabase dashboard, then SQL editor.
   2. Paste `scripts/hosted_logins.sql`.
   3. Set `base` to your inbox and run it.

   You then log in to the console with that inbox. You log in as the G-02 Dono with `you+dono@...`, and as Pantanos with `you+pantanos@...`.
4. **Files behind the seeded imports** (C07 rerun, C17). Take the service role key from Project Settings, API, and run:

   ```sh
   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service role key> node scripts/seed_storage.mjs --hosted
   ```
5. **Authentication:**
   1. Under URL Configuration, set Site URL to the Vercel preview URL from step 2 of the next section. Add `https://*-<your vercel team>.vercel.app/**` to the redirect URLs.
   2. Under SMTP, Supabase's built-in sender allows only a few e-mails an hour. For founders that is enough to start. Before more people log in, add your own SMTP.

## 2. Vercel project

1. In Vercel, Add New, then Project. Import the GitHub repo `margo.ai`.
2. Settings:

   | Setting | Value |
   |---|---|
   | Root Directory | `apps/web` (keep "Include files outside the root directory" on) |
   | Framework | Next.js (detected) |
   | Install / build | defaults; pnpm is detected from the root lockfile |
   | Node.js version | 22.x |
3. Environment variables, scope **Preview** only for now:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon (publishable) key |
   | `SUPABASE_SERVICE_ROLE_KEY` | the service role key (mark Sensitive) |
   | `MARGO_ENV` | `preview` |
   | `MARGO_FLAG_ENV` | `sandbox` |
   | `MARGO_APP_URL` | the preview URL, once known (redeploy after setting it) |
   | `CRON_SECRET` | a long random string, e.g. from `openssl rand -hex 32` (Sensitive) |
4. Under Deployment Protection, turn on Vercel Authentication for Preview, so only your team opens it.
5. **Plan:** Pro, since Hobby is for non-commercial use only. `vercel.json` already sets the São Paulo region (`gru1`) and the daily billing cron.
6. Deploy from a branch to get a preview. Production stays off until 14/nov (08).

## 3. Check it

1. Open the preview URL, then `/console`, and log in with your inbox. The code arrives by e-mail.
2. Open these pages:
   - C01 Clientes
   - the Pantanos X-ray `/console/raio-x/9aae2f75-4168-fde3-4570-d7bd0f4669d0`
   - G-02's close, notes, fichas and contribution
3. In a private window, log in at `/entrar` as `you+dono@...` and check W01 and W05 (5 stores, R$ 1.500).
4. In C14, every secret shows "set" or "missing". Missing ones are expected until step 4.

## 4. Later, as each part goes live

| Part | Needs | Where |
|---|---|---|
| Payments (E01) | `ASAAS_API_KEY` and `ASAAS_WEBHOOK_TOKEN` from the Asaas **sandbox**; webhook URL `<preview>/api/asaas/webhook` | Vercel, Asaas |
| Notice e-mails | the D36 choice (Resend, Postmark or SES), the domain `margoai.com` verified, `EMAIL_PROVIDER_KEY` | Vercel; Claude writes the adapter |
| Workers | Maritime dev agents, `MARITIME_WEBHOOK_SIGNING_KEY`; Claude finishes the REST runner first | Vercel, Maritime |
| Extension | `NEXT_PUBLIC_CHROME_WEB_STORE_URL`, or load it unpacked with `MARGO_API_URL=<preview>` | Vercel |
| Production | a `margoai-prod` Supabase project, the same steps without the G-SYN seed, the Production scope in Vercel, and the DPAs (08 checklist) | |

Tell Claude the preview URL once it runs. Claude never needs the keys.
