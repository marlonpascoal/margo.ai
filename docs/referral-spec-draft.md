# Referral program: draft spec (Marlon, 01/nov)

Not built yet. It needs Marlon's approval of this draft and drawings in the canvas before code (CLAUDE.md: screens are built from `design/`). Once approved, the rules go to spec 04, the tables to 03 and the screens to 05.

## Decisions taken

- **Who refers:** any MargoAI account, on any plan: paying owners, free Raio-X accounts, and partners such as accountants and BPOs with an account. The code belongs to the account, and only the Dono sees and shares it.
- **Reward:** one free month for each side.
- **When it counts:** when the new account's first charge after the trial is paid.
- **How it is recorded:** a personal link plus the same code, typed by hand or set by a founder.

## Rules (proposed IDs for 04)

| ID | Rule |
|---|---|
| `REF-01` | Each account has one referral code: 6 letters and digits, with no confusing characters (0, O, 1, I), and never changes. The link is `margoai.com/?ref=<code>`. |
| `REF-02` | P07 sign-up remembers a code from the link for 30 days (param `ref.window_days`), or takes one typed by hand. A founder can set or fix "indicado por" in C15 until the first paid charge. The code is fixed once the first charge is paid. Every change writes `audit_log`. |
| `REF-03` | A referral is invalid when the new account shares a CNPJ, a person's e-mail or a channel store with the referrer, or is the referrer itself. Invalid referrals are kept, marked with the reason, and never rewarded. |
| `REF-04` | The referral qualifies when the new account's first charge after the trial is paid (Asaas `PAYMENT_RECEIVED` or `PAYMENT_CONFIRMED`). A pilot's first fixed charge counts the same way. A refund or chargeback of that charge within 30 days cancels both rewards if they are not used yet. |
| `REF-05` | Reward for the new account: its next monthly charge is not made, so one month is free. |
| `REF-06` | Reward for the referrer: one month of credit equal to its current monthly amount, used on its next charge. An account with no paid plan keeps the credit until its first paid charge. Credits pile up to a maximum of 12 months a year (param `ref.max_months_year`). |
| `REF-07` | Credits do not expire while the account is active. They are lost when the account is deleted (02 §7). They are never paid out in money. |

## Billing (Asaas)

- A credit skips or discounts the next charge. With an Asaas subscription, the next payment gets a discount equal to the credit before its due date. With pilot single charges, the charge amount is reduced. To be checked against the Asaas recording (`scripts/record_asaas.mjs`).
- E01 billing result and C15 show "1 mês grátis por indicação" on the invoice that used it.

## Screens to draw

- **W05 / P09 Plano:** an "Indique e ganhe" box. It shows:
  - the code and link, with a copy button and a WhatsApp share button
  - how many referrals are pending and how many qualified
  - the credit months available
- **P07 Criar conta:** an optional "Código de indicação" field, pre-filled from the link.
- **C15 Assinaturas:** the "Indicado por" column and editor, the account's credit months, and invalid referrals with their reason.
- **Notice (new):** "Sua indicação virou cliente" to the referrer's Dono when a referral qualifies, by e-mail and, if chosen, by WhatsApp (respecting D36 quiet hours).
- **Flag:** `conta.indicacao`, off until the drawings land and Asaas is checked.

## Data (03)

- `account.referral_code` (unique) and `account.referred_by_account_id`
- `referral`: referrer, referred, source (link, typed, founder), status (pending, qualified, invalid, cancelled), reason, and the qualifying payment id
- `account_credit`: account, months, source referral, the charge where it was used

## Acceptance (07, proposed)

| ID | Proof |
|---|---|
| `E07` | A link sign-up whose first charge is paid gives each side one month. A self-referral or a shared CNPJ gives nothing. A refund cancels unused credit. The yearly limit holds. |

## Open questions

- Can a BPO partner refer on behalf of a client it manages, with the reward going to the partner or to the client?
- Should the new client's free month start right after the trial instead of after the first paid month? That gives the new client a better start, but the first charge then comes a month later.
