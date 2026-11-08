-- Same AI question, same answer (Marlon, 08/nov, D78). A repeated question within one model and prompt version is
-- answered from here with no call. Business menu data only, no account and no store.

create table public.m1_ai_cache (
  use_name text not null,
  key text not null,
  answer jsonb not null,
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (use_name, key)
);
comment on table public.m1_ai_cache is
  'D78: the answer to one AI question, keyed by a hash of the model, the prompt version and the question.';

create trigger set_updated_at before update on public.m1_ai_cache
  for each row execute function app.set_updated_at();
alter table public.m1_ai_cache enable row level security;
create policy read on public.m1_ai_cache for select to authenticated using (app.is_staff());
