-- Login by e-mail code (04 §8, D35, E03).

-- One row per e-mail: the code currently issued, wrong tries, lock. Kept for unknown addresses too,
-- so answers never reveal who has access. Read and written only by server code (service role).
create table public.auth_code_guard (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  sent_at timestamptz,
  attempts int not null default 0 check (attempts >= 0),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.auth_code_guard enable row level security;
create trigger set_updated_at before update on public.auth_code_guard
  for each row execute function app.set_updated_at();

-- Sessions: console 12 hours, portal 30 days. Supabase allows one global limit (config.toml, 30 days);
-- the console limit is enforced per row by the app.
create type public.session_surface as enum ('console', 'portal');

alter table public.session_device
  add column surface public.session_surface not null default 'portal',
  add column auth_session_id uuid unique,
  add column device_key_hash text;
create index session_device_person_device on public.session_device (person_id, device_key_hash);
comment on column public.session_device.auth_session_id is 'session_id claim of the Supabase JWT.';
comment on column public.session_device.device_key_hash is 'sha256 of the device cookie; a new value raises security_event.';
