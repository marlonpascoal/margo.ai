-- G-SYN additions for the wave 2 account screens (W04, P14). Loaded after g_syn.sql.

-- W04: the pending invite is drawn as "Contador".
update public.invite set name = 'Contador'
 where destination = 'contador@exemplo.com.br'
   and account_id = md5('g-syn:G-02')::uuid;
