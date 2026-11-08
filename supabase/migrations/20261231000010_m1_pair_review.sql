-- M1-12 (Marlon, 08/nov, D73): before pairing ends, an AI reviews every automatic pair against a fixed checklist and
-- the run iterates until the pairing is adequate, learning from each run.
--
--   xray_pair_review          one row per X-ray: the score against the target, the rounds, what was rejected and why.
--   m1_pair_review_answer     the verdict for a pair pattern (category, name tokens, description hints of both sides) in
--                             one X-ray run. A re-run of the same X-ray replaces its answer, so it counts once. Business
--                             menu data only, global like m1_attr_learning (no account, no store).
--
-- The worker (margo_collector.pair_review) decides: a pattern with at least m1.pair_review_learning_min_runs runs giving
-- the same verdict and none giving another applies with no AI call.

insert into public.rule_param (key, value, description) values
  ('m1.pair_review_target', 0.95,
   'M1-12: share of the automatic pairs the AI must approve for the pairing to count as adequate.'),
  ('m1.pair_review_max_rounds', 3,
   'M1-12: review rounds per X-ray. What is still unreviewed after the last one goes to the doubts.'),
  ('m1.pair_review_learning_min_runs', 3,
   'M1-12: X-ray runs that must give the same verdict for a pair pattern, with no other verdict, before it applies with no AI call.');

create table public.xray_pair_review (
  xray_id uuid primary key references public.xray (id) on delete cascade,
  status text not null check (status in ('adequado', 'abaixo_da_meta', 'sem_ia', 'sem_resposta')),
  score numeric(5, 4) check (score between 0 and 1),
  first_round_score numeric(5, 4) check (first_round_score between 0 and 1),
  rounds int not null default 0 check (rounds >= 0),
  judged int not null default 0 check (judged >= 0),
  approved int not null default 0 check (approved >= 0),
  rejected int not null default 0 check (rejected >= 0),
  from_learnings int not null default 0 check (from_learnings >= 0),
  sent_to_doubts int not null default 0 check (sent_to_doubts >= 0),
  model text,
  prompt_version text,
  detail jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.xray_pair_review is
  'M1-12: the AI review of one X-ray''s automatic pairs. detail holds each rejection: own item, candidate, the failed check and the round.';

create table public.m1_pair_review_answer (
  pattern text not null,
  xray_id uuid not null references public.xray (id) on delete cascade,
  approved boolean not null,
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (pattern, xray_id)
);
comment on table public.m1_pair_review_answer is
  'M1-12: the AI verdict for a pair pattern in one X-ray run. Rejections that rest only on price or portion are not kept: they belong to that pair, not to the pattern.';

do $$
declare t text;
begin
  foreach t in array array['xray_pair_review', 'm1_pair_review_answer'] loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function app.set_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy read on public.%I for select to authenticated using (app.is_staff())', t);
  end loop;
end $$;
