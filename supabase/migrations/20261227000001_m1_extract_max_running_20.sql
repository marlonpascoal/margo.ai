-- D47d (Marlon, 07/nov): m1.extract_max_running is a safety ceiling; the extractor's worker count is the control.
update public.rule_param
   set value = 20,
       description = 'docs/extract-api.md: safety ceiling of extract jobs running at once, across every extractor'
 where key = 'm1.extract_max_running';
