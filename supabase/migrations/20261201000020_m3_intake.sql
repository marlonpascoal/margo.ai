-- M3 intake: invoice import runs, matching rules and the confirmation of a match (06 §5, §6, D11, D13, D14,
-- C10, C11, CST-01).
--
-- Additions to 03 §4, each needed by a screen or a rule, listed for Marlon:
--   invoice_import: one run of the accountant's XML zip (C10 stats: invoices, months, suppliers, NF-e,
--     NFC-e, duplicates). import_run is per channel (channel not null), so invoices get their own run table
--     with the same status enum and trigger enum;
--   invoice.invoice_import_id: which run brought the invoice;
--   ingredient.short_name: the name the owner reads in P05 ("queijo cheddar", not "Queijo cheddar fatiado");
--   ingredient_rule: D14 step 2 (normalized text plus NCM plus unit), global like the catalog. Rows come from
--     the catalog seed or are learned from a person's confirmation, so the next client maps alone (D14);
--   invoice_line.ai_asked_at: the line went to the Claude API once; it is not sent again (cost, D14);
--   public.confirm_ingredient_match: the one place where a match becomes a CST-01 price.

-- Invoice import runs ------------------------------------------------------------------------------------

create table public.invoice_import (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  trigger public.import_trigger not null default 'upload',
  file_path text not null,
  file_name text,
  status public.import_status not null default 'queued',
  files_total int check (files_total >= 0),
  invoices_total int check (invoices_total >= 0),
  invoices_new int check (invoices_new >= 0),
  duplicates int check (duplicates >= 0),
  rejected int check (rejected >= 0),
  nfe_count int check (nfe_count >= 0),
  nfce_count int check (nfce_count >= 0),
  months_count int check (months_count >= 0),
  suppliers_count int check (suppliers_count >= 0),
  duration_ms int,
  log jsonb not null default '{}',
  job_id uuid references public.job (id) on delete set null,
  created_by uuid references public.person (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoice_import_account_created on public.invoice_import (account_id, created_at desc);
comment on table public.invoice_import is
  'C10 drop zone: one accountant XML zip (D11). invoices_total = distinct valid keys in the zip; duplicates = files skipped because the key was already in the zip or in the database; log carries ids, counts and reasons only (02 §7).';

alter table public.invoice
  add column invoice_import_id uuid references public.invoice_import (id) on delete set null;

-- Catalog additions --------------------------------------------------------------------------------------

alter table public.ingredient add column short_name text;
comment on column public.ingredient.short_name is 'P05: lower-case name the owner reads on WhatsApp; null falls back to the name.';

create table public.ingredient_rule (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredient (id) on delete cascade,
  keywords text[] not null check (cardinality(keywords) > 0),
  ncm_prefix text check (ncm_prefix ~ '^\d{2,8}$'),
  unit text,
  source text not null check (source in ('catalog', 'confirmation')),
  created_by uuid references public.person (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (ingredient_id, keywords, ncm_prefix, unit)
);
comment on table public.ingredient_rule is
  'D14 step 2: an invoice line matches when every keyword is a token of its normalized description, its NCM starts with ncm_prefix (if set) and its unit equals unit (if set). Global, no account_id.';

alter table public.invoice_line add column ai_asked_at timestamptz;

do $$
declare t text;
begin
  foreach t in array array['invoice_import', 'ingredient_rule'] loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function app.set_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy read on public.invoice_import for select to authenticated
  using (app.is_staff() or app.is_member(account_id));
create policy read on public.ingredient_rule for select to authenticated using (app.is_staff());

-- Confirmation (C11, D14, CST-01) ------------------------------------------------------------------------

-- A match becomes the line's only confirmed match and writes the line's CST-01 price: centavos per base
-- unit = line total / (qty * base units per invoice unit), observed on the invoice date in São Paulo.
-- Other matches of the line are rejected and their price removed. An AI or manual match needs a person
-- (D14); GTIN and rule matches are confirmed by worker-match with p_person null. A line's GTIN joins the
-- ingredient's GTIN list, so the next invoice with that barcode matches alone. Service role only: the
-- console calls it from an audited server action (A04).
create function public.confirm_ingredient_match(p_match uuid, p_person uuid, p_conversion numeric default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m public.ingredient_match;
  l record;
  conv numeric;
  price_id uuid;
begin
  select * into m from public.ingredient_match where id = p_match for update;
  if not found then raise exception 'match_not_found'; end if;
  if m.method in ('ai', 'manual') and p_person is null then raise exception 'person_required'; end if;
  conv := coalesce(p_conversion, m.conversion_factor);
  if conv is null or conv <= 0 then raise exception 'conversion_required'; end if;
  select il.id, il.qty, il.total_cents, il.gtin, i.issued_at into l
    from public.invoice_line il join public.invoice i on i.id = il.invoice_id
   where il.id = m.invoice_line_id;

  update public.ingredient_match set status = 'rejected'
   where invoice_line_id = m.invoice_line_id and id <> m.id and status <> 'rejected';
  delete from public.ingredient_price where invoice_line_id = m.invoice_line_id;
  update public.ingredient_match
     set status = 'confirmed', conversion_factor = conv,
         confirmed_by = case when p_person is null then confirmed_by else p_person end
   where id = m.id;
  insert into public.ingredient_price (account_id, ingredient_id, price_per_base_unit_cents, observed_on, source, invoice_line_id)
  values (m.account_id, m.ingredient_id, l.total_cents::numeric / (l.qty * conv),
          (l.issued_at at time zone 'America/Sao_Paulo')::date, 'invoice', l.id)
  returning id into price_id;
  if l.gtin is not null then
    update public.ingredient set gtin = array_append(gtin, l.gtin)
     where id = m.ingredient_id and not (l.gtin = any (gtin));
  end if;
  return price_id;
end $$;
revoke all on function public.confirm_ingredient_match(uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.confirm_ingredient_match(uuid, uuid, numeric) to service_role;
