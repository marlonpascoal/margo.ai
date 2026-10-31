-- G-SYN module 3 intake additions (C10, C11, P05, D14). SINTÉTICO. Loads after g_syn_m3.sql (cost lane),
-- which holds the catalog, Grupo Exemplo's (G-02) 312 invoices, their lines, matches and prices. Nothing here
-- changes a number of that seed; it adds what only the intake tables carry:
--   1. P05 short names of the catalog ("queijo cheddar", "bacon", "pão brioche", "embalagem");
--   2. D14 catalog rules, one per seeded rule match (normalized words of the description plus NCM heading or
--      unit, as its rule_note says), so worker-match maps the same texts of the next client alone;
--   3. C10's accountant zip run of G-02: the 312 seeded invoices as one import, plus the 9 duplicate files
--      the drawing counts ("duplicadas: 9").

create or replace function pg_temp.sid(tag text) returns uuid language sql immutable as $$ select md5('g-syn:' || tag)::uuid $$;

-- 1. P05 short names --------------------------------------------------------------------------------------
update public.ingredient i set short_name = s.short_name
from (values
  ('Carne bovina moída (blend)', 'carne moída'),
  ('Queijo cheddar fatiado', 'queijo cheddar'),
  ('Bacon em cubos', 'bacon'),
  ('Pão brioche', 'pão brioche'),
  ('Maionese (base de molho)', 'maionese'),
  ('Embalagem kraft', 'embalagem'),
  ('Batata congelada palito', 'batata palito'),
  ('Refrigerante lata 350 ml', 'refrigerante lata'),
  ('Óleo de soja', 'óleo de soja'),
  ('Sal refinado', 'sal'),
  ('Cebola', 'cebola'),
  ('Sorvete de creme', 'sorvete'),
  ('Leite integral', 'leite'),
  ('Calda de chocolate', 'calda de chocolate'),
  ('Copo 400 ml com tampa', 'copo 400 ml'),
  ('Coxa e sobrecoxa de frango', 'coxa e sobrecoxa'),
  ('Farinha de trigo', 'farinha de trigo'),
  ('Filé de peito de frango', 'filé de frango'),
  ('Molho barbecue', 'molho barbecue'),
  ('Balde de papel', 'balde de papel'),
  ('Alface americana', 'alface'),
  ('Tomate', 'tomate'),
  ('Ketchup', 'ketchup'),
  ('Açúcar refinado', 'açúcar')
) as s(name, short_name)
where i.name = s.name;

-- 2. D14 catalog rules from the seeded rule matches ------------------------------------------------------
-- Keywords: the description's words of two letters or more (same as margo_match.matching.learned_rule).
insert into public.ingredient_rule (ingredient_id, keywords, ncm_prefix, unit, source)
select distinct m.ingredient_id,
       (select array_agg(distinct w order by w) from regexp_split_to_table(upper(il.description), '[^A-Z0-9,.]+') w where w ~ '^[A-Z]{2,}$'),
       case when m.rule_note like 'texto + NCM %' then left(il.ncm, 4) end,
       case when m.rule_note = 'texto + unidade' then upper(il.unit) end,
       'catalog'
from public.ingredient_match m
join public.invoice_line il on il.id = m.invoice_line_id
where m.method = 'rule' and m.rule_note is not null
on conflict (ingredient_id, keywords, ncm_prefix, unit) do nothing;

-- 3. C10: the accountant zip of G-02 ----------------------------------------------------------------------
insert into public.invoice_import (id, account_id, trigger, file_path, file_name, status, files_total, invoices_total,
                                   invoices_new, duplicates, rejected, nfe_count, nfce_count, months_count,
                                   suppliers_count, duration_ms, log, created_by, created_at)
select pg_temp.sid('G-02:invoice_import:zip'), a.id, 'upload', 'invoices/G-02/zips/contador-SINTETICO.zip',
       'contador-SINTETICO.zip', 'ok', count(*) + 9, count(*), count(*), 9, 0,
       count(*) filter (where i.model = 55), count(*) filter (where i.model = 65),
       count(distinct to_char(i.issued_at at time zone 'America/Sao_Paulo', 'YYYY-MM')),
       count(distinct i.issuer_cnpj), 4200, '{"seed": true}', pg_temp.sid('p:marlon'), '2026-10-29 10:00-03'
from public.account a join public.invoice i on i.account_id = a.id
where a.code = 'G-02'
group by a.id;

update public.invoice set invoice_import_id = pg_temp.sid('G-02:invoice_import:zip')
where account_id = (select id from public.account where code = 'G-02');
