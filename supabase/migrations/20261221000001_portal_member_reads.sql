-- Portal pages read with the person's session, so RLS applies to them (D63, 02 §5). W01 and P08 "Relatórios"
-- list the account's X-ray and /app/relatorios/raio-x serves its PDF. 04 §5: the X-ray covers the whole
-- account, so only people who see all kitchens (app.sees_kitchen with no kitchen), and only one with a PDF.
-- Drafts and the rest of the M1 tables stay console only.
create policy read_member on public.xray for select to authenticated
  using (pdf_path is not null and account_id is not null and app.sees_kitchen(account_id, null));
