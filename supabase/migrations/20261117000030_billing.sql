-- Wave 2 billing (04 §7, 06 §4, D27, D28, D37, D40): what the Asaas adapter, the webhook, the billing jobs,
-- P09/W05 and C15 need beyond the 03 §5 tables of the base migration.

-- 04 §7 "Trial ends without a plan: channel imports stop (sources paused), data kept".
-- Schedulers and the extension upload skip a paused source; flags (raio_x defaults) gate the jobs too.
alter table public.import_source
  add column paused_at timestamptz,
  add column paused_reason text check (paused_reason in ('trial_ended', 'subscription_canceled'));
comment on column public.import_source.paused_at is
  '04 §7: set when the account returns to free (trial end, canceled subscription). Null: the source runs.';

-- P09/W05 "preços de exemplo until prices are set" (D28, D40): a plan field, cleared in C15.
alter table public.plan add column price_is_example boolean not null default true;
comment on column public.plan.price_is_example is 'P09/W05 show "preços de exemplo" while true; cleared in C15 when prices are set (D40).';

-- W05 "Faturas": one row per Asaas payment of the subscription, kept by the webhook (06 §4).
create type public.invoice_status as enum ('pending', 'confirmed', 'overdue', 'refused', 'canceled');

create table public.billing_invoice (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account (id) on delete cascade,
  asaas_payment_id text not null unique,
  asaas_subscription_id text,
  due_on date,
  units int check (units >= 0),
  amount_cents bigint not null check (amount_cents >= 0),
  status public.invoice_status not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.billing_invoice is 'W05 Faturas: Asaas payments of the subscription, from webhooks (06 §4). Pilot charges stay in pilot_charge.';
create index billing_invoice_account on public.billing_invoice (account_id, due_on desc);

create trigger set_updated_at before update on public.billing_invoice
  for each row execute function app.set_updated_at();

alter table public.billing_invoice enable row level security;
-- 04 §5: plan, card and invoices are Dono only; the console reads with the service role after its check.
create policy read on public.billing_invoice for select to authenticated
  using (app.is_dono(account_id) or app.is_fundador());

-- billing_event: what the parser understood, so C15 and the jobs need not re-read raw payloads.
alter table public.billing_event add column kind text;
comment on column public.billing_event.kind is
  'Internal event type from the parser (payment_confirmed, payment_overdue, payment_refused, subscription_created, subscription_deleted, unknown).';

-- pilot_charge.status values (D37): pending (charge being created at Asaas), charged, no_charge, paid, refused.
alter table public.pilot_charge
  add constraint pilot_charge_status check (status in ('pending', 'charged', 'no_charge', 'paid', 'refused'));
comment on column public.pilot_charge.status is
  'pending: being sent to Asaas (a pending row is never resent automatically); charged; no_charge (nothing credited); paid; refused.';
comment on column public.pilot.fixed_from_day_61_cents is 'D37: fixed monthly price per billing unit from day 61 (C15 "A partir do mês 3", drawn "R$ 300 por cozinha").';
