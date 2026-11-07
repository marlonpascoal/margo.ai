-- M1-04 Stage 2 (Marlon, 07/nov): what the AI read about non-beverage items the rules cannot read is learned, so the
-- rule layer improves. Mirrors the hybrid ingredient rules of M3 (ingredient_rule.auto_confirm and disputed_at).
--
--   m1_attr_learning      one pattern: category, normalized name tokens, the words of the fixed lists the
--                         description holds. Business menu data only, global like ingredient_rule (no account). A
--                         founder's attributes (C04) win over any AI answer; a founder rejecting a pair the AI made
--                         disputes the pattern.
--   m1_attr_learning_run  the AI's answer for the pattern in one X-ray run, with the model and the confidence; a re-run
--                         of the same X-ray replaces its answer, so it counts once.
--
-- The worker (margo_collector.learning) decides: promoted when at least m1.attr_learning_min_runs runs gave the same
-- answer and none gave another, then applied like a rule with no AI call; disputed with two answers. Without
-- ANTHROPIC_API_KEY the worker neither reads nor writes these tables.

insert into public.rule_param (key, value, description) values
  ('m1.attr_learning_min_runs', 3,
   'M1-04 Stage 2: X-ray runs that must give the same AI answer for a pattern, with no other answer, before it applies like a rule');

create table public.m1_attr_learning (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('lanches', 'porcoes', 'pratos', 'sobremesas', 'adicionais')),
  tokens text[] not null,
  hints text[] not null default '{}',
  founder_attrs jsonb,
  founder_by uuid references public.person (id) on delete set null,
  founder_at timestamptz,
  founder_disputed_at timestamptz,
  items_seen int not null default 0 check (items_seen >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category, tokens, hints)
);
comment on table public.m1_attr_learning is
  'M1-04 Stage 2: a pattern of a non-beverage item the rules cannot read (category, name tokens, description hints) and what was learned about it. founder_attrs wins over the AI; founder_disputed_at marks a pair the AI made that a founder rejected. items_seen counts the items seen with the pattern in runs that asked the AI.';

create table public.m1_attr_learning_run (
  learning_id uuid not null references public.m1_attr_learning (id) on delete cascade,
  xray_id uuid not null references public.xray (id) on delete cascade,
  attrs jsonb not null,
  model text not null,
  confidence numeric(5, 4) check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (learning_id, xray_id)
);
comment on table public.m1_attr_learning_run is
  'M1-04 Stage 2: the AI answer (base, proteinas, carnes, peso_g, porcao, extras) for a pattern in one X-ray run, with the model and the confidence the answer gave.';

do $$
declare t text;
begin
  foreach t in array array['m1_attr_learning', 'm1_attr_learning_run'] loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function app.set_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy read on public.%I for select to authenticated using (app.is_staff())', t);
  end loop;
end $$;
