-- M3 row level security (02 §5, 04 §5). SELECT policies only, as in 20261031000002_rls.sql: every
-- write goes through a worker or an audited server action with the service role.
--
-- Scope (04 §5 "Send purchase invoices: own kitchens only"): an invoice belongs to a company, and a
-- company to kitchens, so a person sees an invoice when they see a kitchen of its company, or all
-- kitchens. Contribution follows its close (a whole-account close needs all kitchens). Dishes, recipes
-- and packaging are per brand, account wide, like brand and menu_item. The global ingredient catalog
-- is read by staff; a portal person sees only ingredients their own visible rows refer to.

do $$
declare t text;
begin
  foreach t in array array[
    'invoice', 'invoice_line', 'ingredient', 'ingredient_match', 'ingredient_price', 'recipe', 'recipe_line',
    'packaging_cost', 'contribution'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- menu_item was console only (M1); C13 and P06 name dishes for the owner. Same scope as brand.
create policy read_member on public.menu_item for select to authenticated using (app.is_member(account_id));

create policy read on public.invoice for select to authenticated
  using (
    app.is_staff()
    or app.sees_kitchen(account_id, null)
    or exists (select 1 from public.kitchen k where k.account_id = invoice.account_id and k.company_id = invoice.company_id)
  );
create policy read on public.invoice_line for select to authenticated
  using (exists (select 1 from public.invoice i where i.id = invoice_id));
create policy read on public.ingredient_match for select to authenticated
  using (exists (select 1 from public.invoice_line il where il.id = invoice_line_id));
create policy read on public.ingredient_price for select to authenticated
  using (
    app.is_staff()
    or (invoice_line_id is null and app.is_member(account_id))
    or (invoice_line_id is not null and exists (select 1 from public.invoice_line il where il.id = invoice_line_id))
  );

create policy read on public.recipe for select to authenticated
  using (app.is_member(account_id) or app.is_staff());
create policy read on public.recipe_line for select to authenticated
  using (exists (select 1 from public.recipe r where r.id = recipe_id));
create policy read on public.packaging_cost for select to authenticated
  using (app.is_member(account_id) or app.is_staff());

create policy read on public.contribution for select to authenticated
  using (exists (select 1 from public.close_period cp where cp.id = close_period_id));

create policy read on public.ingredient for select to authenticated
  using (
    app.is_staff()
    or exists (select 1 from public.recipe_line rl where rl.ingredient_id = ingredient.id)
    or exists (select 1 from public.ingredient_match im where im.ingredient_id = ingredient.id)
    or exists (select 1 from public.ingredient_price ip where ip.ingredient_id = ingredient.id)
  );

-- Accountant XML files and invoice photos. Private: served by the app after its own check.
insert into storage.buckets (id, name, public) values ('invoices', 'invoices', false) on conflict (id) do nothing;
