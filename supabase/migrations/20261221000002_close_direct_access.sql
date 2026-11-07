-- Nothing reads the database as anon: pages before login use server functions (P07, /criar-conta, invites),
-- and the anon key only opens Supabase Auth. Portal sessions read through RLS (D63, 02 §5); no policy grants
-- a write, so authenticated keeps SELECT only. RLS does not cover TRUNCATE, hence removing the grant itself.
-- Default privileges keep tables created later the same way (their RLS policies still decide the rows).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
revoke usage, update on all sequences in schema public from authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from authenticated;
alter default privileges for role postgres in schema public revoke usage, update on sequences from authenticated;

-- The two public reference policies no longer have an anon audience.
alter policy read on public.plan to authenticated;
alter policy read on public.notice_type to authenticated;
