-- P23 "Como fizemos" (Marlon, 11/nov): the report says which categories the run searched for its neighbors (M1-01,
-- D76), with each one's share of the own menu when the menu set it. Public words only, no store.
create function public.monitor_search_terms(p_xray uuid)
returns table (term text, menu_share numeric)
language sql stable security definer set search_path = '' as $$
  select t.term, round((x.rules -> 'menu_term_shares' ->> t.term)::numeric, 2)
    from public.xray x, unnest(x.categories) with ordinality t(term, n)
   where x.id = p_xray
   order by (x.rules -> 'menu_term_shares' ->> t.term)::numeric desc nulls last, t.n
$$;
revoke all on function public.monitor_search_terms(uuid) from public, anon, authenticated;
grant execute on function public.monitor_search_terms(uuid) to service_role;
