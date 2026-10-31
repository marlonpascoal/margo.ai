-- M2 row level security (02 §5, 04 §5). SELECT policies only, as in 20261031000002_rls.sql: every
-- write goes through worker-import or an audited server action with the service role.
--
-- Kitchen-scoped data follows the channel store: a row is visible when its store is visible, and
-- channel_store's own policy applies app.sees_kitchen (A03) or staff.

do $$
declare t text;
begin
  foreach t in array array[
    'rule_param', 'import_source', 'column_mapping', 'import_run', 'order_fact', 'order_item_fact',
    'ledger_entry', 'contract_terms', 'campaign', 'close_period', 'close_line', 'difference',
    'difference_order', 'contestation'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Parameters are not tenant data.
create policy read on public.rule_param for select to authenticated using (true);

-- Import plumbing is console only (C07, C17): logs name stores of every kitchen.
create policy read on public.import_source for select to authenticated using (app.is_staff());
create policy read on public.import_run for select to authenticated using (app.is_staff());
create policy read on public.column_mapping for select to authenticated using (app.is_staff());

-- Store-scoped facts and results.
create policy read on public.order_fact for select to authenticated
  using (exists (select 1 from public.channel_store cs where cs.id = channel_store_id));
create policy read on public.order_item_fact for select to authenticated
  using (exists (select 1 from public.order_fact o where o.id = order_fact_id));
create policy read on public.ledger_entry for select to authenticated
  using (exists (select 1 from public.channel_store cs where cs.id = channel_store_id));
create policy read on public.contract_terms for select to authenticated
  using (exists (select 1 from public.channel_store cs where cs.id = channel_store_id));
create policy read on public.campaign for select to authenticated
  using (exists (select 1 from public.channel_store cs where cs.id = channel_store_id));
create policy read on public.close_line for select to authenticated
  using (exists (select 1 from public.channel_store cs where cs.id = channel_store_id));
create policy read on public.difference for select to authenticated
  using (exists (select 1 from public.channel_store cs where cs.id = channel_store_id));
create policy read on public.difference_order for select to authenticated
  using (exists (select 1 from public.difference d where d.id = difference_id));
create policy read on public.contestation for select to authenticated
  using (exists (select 1 from public.difference d where d.id = difference_id));

-- A close for the whole account (kitchen_id null) needs all kitchens; a kitchen close, that kitchen.
create policy read on public.close_period for select to authenticated
  using (app.sees_kitchen(account_id, kitchen_id) or app.is_staff());

-- Private buckets: uploaded statements (imports) and rendered closes (closes). Service role only.
insert into storage.buckets (id, name, public) values ('imports', 'imports', false), ('closes', 'closes', false)
  on conflict (id) do nothing;
