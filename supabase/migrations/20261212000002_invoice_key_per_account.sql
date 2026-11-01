-- Invoice access key unique per account, not across accounts (Marlon, 31/out, docs/build-review.md Wave 3).
-- A global unique key told a second account that the invoice existed in another one. Dedup (D11) now stays
-- within the account: the same NF-e can be saved once by each account that bought or received it, and the
-- intake (worker-import, C10) looks for duplicates only inside the account.

alter table public.invoice drop constraint invoice_access_key_key;
alter table public.invoice add constraint invoice_account_access_key_key unique (account_id, access_key);

comment on table public.invoice is
  '03 §4: purchase invoice (NF-e 55, NFC-e 65). Deduped by access_key within the account (D11, 31/out). company_id: the buyer company of the account.';
