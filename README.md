# MargoAI, build package

Spec, screens, decisions and rules for building MargoAI with Claude Code on the Mac mini.

| Path | What |
|---|---|
| `CLAUDE.md` | Rules Claude Code follows in every session |
| `.claude/settings.json` | Permissions: what Claude Code runs without asking, and what it can never run |
| `spec/` | The spec, 01 to 08. Start with `01-product.md` and `08-build-plan.md` |
| `design/` | The screens (`*.dc.html`) from the canvas, read-only reference |
| `docs/decisions.md` | Decisions D01 to D48 |
| `docs/legal/` | Drafts for the lawyer (authorization, privacy, terms) |

## 1. Prepare the Mac mini (once)

In Terminal:

```bash
# Homebrew, if missing: https://brew.sh
brew install node@22 pnpm uv git supabase/tap/supabase
brew install --cask docker visual-studio-code
open -a Docker        # the local database runs in Docker; wait until it says "running"
node -v && pnpm -v && uv --version && supabase --version && docker info > /dev/null && echo ready
```

In VS Code, install the **Claude Code** extension and sign in.

## 2. Create the project folder

The package is in `~/Projects/margo.ai` on the Mac mini (copied there by Claude). If you got it as a zip instead, unzip it to that path.

```bash
cd ~/Projects/margo.ai
git init -b main
git add . && git commit -m "Spec, screens and decisions"
code .
```

## 3. Start the build (wave 0)

1. In VS Code, open the Claude Code panel.
2. Paste this as the first message:

> Read CLAUDE.md, spec/01-product.md, spec/02-architecture.md, spec/03-data-model.md and spec/08-build-plan.md. Then build Wave 0 of spec/08-build-plan.md, one task at a time, tests first, following the session protocol. After each task, stop and summarize which acceptance rows pass.

3. Watch the files appear in the explorer and the diffs in the panel. Edits and build commands run without asking; anything blocked in `.claude/settings.json` is refused.
4. After each task: read the summary, then `git log` to see the commit. You push (`git push`), Claude Code never does.

## 4. Wave 1, two lanes in parallel

When wave 0 passes:

```bash
cd ~/Projects/margo.ai
git worktree add ../margo.ai-m1 -b lane-m1
git worktree add ../margo.ai-m2 -b lane-m2
code ../margo.ai-m1 && code ../margo.ai-m2
```

In the `margo.ai-m1` window: "Build Wave 1, lane A (M1), from spec/08-build-plan.md." In the `margo.ai-m2` window: "Build Wave 1, lane B (M2 from files)." You merge both into `main`.

## 5. Things only you do (not Claude Code)

| When | What |
|---|---|
| Now | Register at developer.ifood.com.br with your CNPJ and an e-mail not tied to any Partner Portal account. You get a test store and a test app |
| Now | Create a GitHub repository (private) and push `main` |
| Before 13/nov | Supabase: two projects in São Paulo, `margoai-dev` and `margoai-prod` |
| Before 13/nov | Vercel: import the GitHub repo, region São Paulo, link the dev Supabase project to Preview and prod to Production, set the env vars of spec/02 §6 |
| Before 13/nov | Maritime: create the four worker agents (`worker-import`, `worker-collector`, `worker-match`, `worker-render`) for dev and prod, set their env vars, create the cron trigger for the daily import |
| Before wave 2 | Asaas sandbox account and API key, webhook pointing to the preview URL |
| iFood spike | Run the live calls with Claude Code beside you, so the responses become fixtures (spec/06 §1) |
| Before 16/nov | Signed data authorization from the first E4 group (docs/legal, after the lawyer) |

Secrets go only into the Vercel, Supabase and Maritime dashboards. Never into a file in this folder.
