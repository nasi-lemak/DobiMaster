# Legal review brief: privacy notice and terms of use

**For:** a Malaysian lawyer reviewing DobiMaster's customer-facing legal texts before a pilot.
**Status:** DRAFT. The texts were written by the product team (with AI assistance) to match exactly what the software stores and does. They have **not** been reviewed by a lawyer.

## What to review

| Text | Where it lives | Languages |
|---|---|---|
| Privacy notice | `/privacy` on the live site; source in [`apps/web/src/legal/content.ts`](../apps/web/src/legal/content.ts) | Bahasa Malaysia, English, 中文 |
| Terms of use (customers + shop owners) | `/terms`; same source file | BM and English in full. 中文 for the customer part only. |

Edits can be made directly in that file, or sent as a marked-up copy for the developer to apply.

- **Operator details** (name, SSM number, address, contact email, server location) are settings, not text: `LEGAL_*` in `deploy/.env`.
- **Retention periods** are generated from the same numbers the server's daily deletion job uses, so the notice can't promise something the system doesn't do.

## What the product is (context)

DobiMaster is software that self-service laundromats ("dobi") use:
- **Customers** scan a QR code on a machine to see instructions and start a timer, then get an alert when their laundry is nearly done. They can also report a problem, e.g. "machine took my coins". **There is no customer account:** a random ID is stored on the phone.
- **Shop owners** get a dashboard with machine status, problem reports, refunds, cash collection and analytics.

**Business model:** the operator (the company running DobiMaster) offers it to many independent laundromat owners as a service. Each shop owner signs up and accepts the terms.

## Personal data actually processed

| Who | Data | Purpose | Retention (enforced automatically) |
|---|---|---|---|
| Customer | Random device ID; timers (machine, times) | Countdown, alerts, anonymous usage statistics for the shop | Kept as shop business records; unlinked when the customer deletes their data |
| Customer | Browser push subscription | "Almost done" alerts | Until the customer deletes their data or turns notifications off |
| Customer (optional) | WhatsApp number and messages sent to us | Laundry alerts on WhatsApp (Meta WhatsApp Cloud API) | Number: 180 days after the last inbound message. Message log: 30 days. |
| Customer (optional) | Problem report text and up to 3 photos | Machine repair and refunds | Photos: 180 days after the report is closed |
| Customer (optional) | Phone number for a refund | Paying the refund (e.g. DuitNow) | 90 days after the report or refund is closed |
| Customer | Payment record (amount, machine, result) | In-app payment, when enabled (it is off for now) | Kept as business records; card data never touches our systems |
| Everyone | IP address, browser type in server logs | Security, abuse prevention | Log rotation is by size (about 50 MB per service), so the duration varies. **Decide a stated period.** |
| Owner and staff | Name, email, password (hashed), signed-in devices (browser, IP), audit log of actions, checklist photos | Running the account; accountability; weekly email summary | While the account is active |

**Customer self-service erasure:** My laundry → "Delete my data on this phone" works immediately.
- **Deleted at once:** the device ID, push subscription, WhatsApp link and message log, and waiting-list entries.
- **Kept but unlinked from the person:** the shop's records (timers, payments, problem reports).
- **Phone numbers:** removed from closed reports straight away. Open reports keep the phone number until resolved so the refund can still be paid; the customer is told this.

**Hosting:** one server. The default location in the docs is Singapore (a cloud provider); it can be hosted in Malaysia instead if preferred.

**Sub-processors:**
- the hosting provider,
- browser push services (Google / Apple / Mozilla),
- Meta (WhatsApp, if the customer links it),
- an email delivery service (owner emails only),
- a payment gateway (when enabled; candidates are CHIP or HitPay).

## Questions for the lawyer

1. **Roles under the PDPA.** The shop owner sees customers' reports and refund phone numbers. Is the operator the data user and the shop owner a separate data user for what they see? Or is the operator a data processor for each shop? The drafts currently present the operator as "we" and tell customers the shop sees their reports. The owner terms require owners to use customer data only for that report or refund.
2. **PDPA (Amendment) Act 2024.** Please confirm what applies at pilot scale and what the texts or processes need for:
   - data breach notification (to the Commissioner and to affected individuals),
   - appointing a data protection officer,
   - the data portability right,
   - data processors' security obligations.
3. **Cross-border transfer** (s.129, as amended). Is hosting in Singapore with the safeguards described adequate, and is the notice wording sufficient? Or should we simply host in Malaysia?
4. **Consent model.** Customers have no account. Is notice plus use (the notice is linked on every page, and data fields are optional) sufficient? Or do we need an explicit tick-box before the first timer, report or WhatsApp link?
5. **Bahasa Malaysia text.** Please check the BM versions read correctly as legal text; s.7(3) requires BM and English.
6. **Data access requests.** The notice promises a reply within 21 days. Is a fee policy needed?
7. **Server log retention:** what period should we state and enforce?
8. **Owner terms:**
   - **Liability cap** of fees paid in the previous 12 months, which is zero during a free pilot. Is that enforceable or appropriate?
   - Exclusion of indirect loss.
   - **Interaction with the Consumer Protection Act 1999** for sole-proprietor owners.
   - **Account closure:** 30-day deletion on closing an account.
   - **Fee changes:** 30 days' notice.
9. **Customer terms:**
   - Disclaimer for loss or damage of laundry; the shop's own rules remain the shop's responsibility.
   - Statement that status and timers are estimates.
10. **When in-app payments go live:**
    - refund terms,
    - wording on the gateway's role (we never hold customer funds; payment goes direct to the shop's merchant account),
    - anything required by the gateway or Bank Negara.
11. **Company details:** confirm what must appear (SSM name and number, registered address). The operator should be a registered entity before launch.

## After review

1. Apply the edits in `apps/web/src/legal/content.ts`.
2. Bump `LEGAL_VERSION` in `packages/shared/src/defaults.ts`. New owner sign-ups record the version they accepted, and the page shows the date.
3. Deploy (`deploy/scripts/update.sh`).
