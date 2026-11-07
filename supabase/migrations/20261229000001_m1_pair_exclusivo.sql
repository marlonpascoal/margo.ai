-- M1-04 Stage 2 (Marlon, 07/nov): a lanche or porção with no item of the same attributes in any store of the set is
-- "exclusivo, sem comparação". Not `revisar`, not a problem, outside parity, loss and the Pareto; a founder can still
-- pair it by hand in C04. Its own migration: a new enum value is usable only after the transaction that adds it.
alter type public.pair_status add value if not exists 'exclusivo';
