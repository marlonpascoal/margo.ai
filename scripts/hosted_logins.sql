-- Hosted dev project only (docs/deploy-preview.md). Marlon runs this once in the Supabase SQL editor,
-- right after loading the G-SYN seed, before anyone asks for a login code.
--
-- Why: the seed's people and invites use fictional addresses at exemplo.com.br, a real domain. On a
-- hosted project login codes are real e-mails, so every seed address is moved to a plus alias of one
-- inbox you own. Marlon's own person gets that inbox itself.
--
-- Before running: replace the address on the "base" line with your inbox (Gmail and most providers
-- accept plus aliases). Nothing else changes: names, roles and data stay as seeded.

do $$
declare
  base constant text := 'seu-email@exemplo.com';  -- replace with your inbox
  local_part text := split_part(base, '@', 1);
  domain_part text := split_part(base, '@', 2);
begin
  if base = 'seu-email@exemplo.com' or position('@' in base) = 0 then
    raise exception 'Set base to your own inbox first.';
  end if;
  if not exists (select 1 from public.account where is_synthetic) then
    raise exception 'No G-SYN account here: load the seed first.';
  end if;

  update public.person set email = base where email = 'marlon@margoai.com';

  update public.person
     set email = local_part || '+' || split_part(email, '@', 1) || '@' || domain_part
   where email like '%@exemplo.com.br';

  update public.invite
     set destination = local_part || '+' || split_part(destination, '@', 1) || '@' || domain_part
   where channel = 'email' and destination like '%@exemplo.com.br';

  raise notice 'Logins now: % (Marlon), %+dono@%, %+pantanos@%, ...', base, local_part, domain_part, local_part, domain_part;
end $$;
