# 04 · Business: costs, pricing, risks, competitors, plan

This document covers deliverables **13–17**. The market facts come from [research/competitor-research.md](research/competitor-research.md), which has sources and marks what is unverified. The figures below are **estimates**: USD→MYR is taken as ≈ 4.2, and cloud list prices are as of 2026.

---

## 16. Competitor comparison

| | **Malaysian QR-retrofit boards** (Transpire, One Pay, Laundro, Dobipay, Hiro, QR Pay For Vending) | **Chain apps** (dobiQueen, LaundryBar LB Pay, Cleanpro Plus, Hiro/myDobi) | **OEM platforms** (Speed Queen Insights, DexterLive, Girbau Sapphire, Electrolux) | **US retrofit/SaaS** (PayRange, Cents/Laundroworks, CCI, SpyderWash) | **DobiMaster** |
|---|---|---|---|---|---|
| Works with any brand of machine | ✅ via coin-pulse | Only their own shops | ❌ own brand only | Needs their readers | ✅ software alone; any brand with a clamp sensor |
| Knows whether the machine **actually** runs | ❌ one-way pulse | ❌ (complaints: "paid, didn't start") | ✅ | Partly | ✅ power/current sensing; **start confirmed or auto-refund** |
| Live availability for customers | Rare | Some | ✅ (own brand) | Some | ✅ sensor; honest "from check-ins" label without sensors |
| Laundry-done alerts | Rare | Some apps | ✅ | ✅ | ✅ web push, no install; WhatsApp in Phase 2 |
| Works for **pure-coin** shops | ❌ you must buy the payment board | n/a | ❌ | ❌ | ✅ timers, reports, collections, counter reconciliation |
| Owner ops (tickets, checklists, maintenance, refunds) | Basic (remote credit inject, alerts) | In-house | Partial | Cents: strong (US) | ✅ core focus |
| Cash revenue audit (coins vs cycles) | ❌ | ❌ | Partial | ❌ | ✅ counter- or sensor-based |
| Wallet / forced top-up | Some | **Yes** (RM 10–30 minimums, fees; top complaint) | Some | PayRange: fixed amounts | **Never.** Pay per cycle. |
| Up-front cost | RM 3.5–8k per 10-machine shop (vendor claim) | Franchise package | New machines | US$80+/reader + fees | RM 0 (software) → about RM 150–250 per machine for sensors |

**What competitors already solve well:** cashless payment at the machine (the QR boards), a polished app for chains with their own fleets, and rich telemetry on new OEM machines.

**What customers still complain about:**
- Paid but the machine didn't start.
- Slow or impossible refunds.
- Forced wallet top-ups and fees.
- Login and OTP failures.
- Dryers that don't dry or cut out early.
- Dirty shops.
- Laundry left in machines.
- Not knowing what's available.
- No receipts.

**What owners still handle manually:**
- Refunds over WhatsApp.
- Coin counting and reconciliation.
- Discovering downtime.
- Checking cleaning was done.
- Maintenance schedules.
- Franchise royalty reporting.

**Unnecessarily complicated:**
- Wallet systems with top-up tiers.
- Account creation before first use.
- Proprietary kiosks.
- Per-machine card readers when most customers already carry DuitNow QR.

**Opportunities specific to Malaysia and SEA:**
1. **A neutral "state truth" layer.** It sits beside whatever payment hardware is already there (coins, tokens, any QR board, PayWave, OEM), and nobody local sells one.
2. **Automatic refunds from observation.** This is the rule-based answer to the most common complaint.
3. **Auditing the coin economy** that still dominates independent shops.
4. **Micropayment-sane rails.** Dynamic DuitNow QR costs about 1–1.2% (CHIP, HitPay). FPX and cards carry a fixed fee around RM 1, which is 10–25% of a RM 5 wash.
5. **WhatsApp-native notifications**, because iOS web push needs the app installed to the home screen.
6. **Neutral revenue figures for franchise royalty checks.** Royalties run 3–10% of revenue.

**Main competitive risks:**
- Local QR vendors add clamp sensing.
- Speed Queen Insights grows in Malaysia (already marketed there).
- Chains keep everything in-house.

**Positioning to defend:** payment- and brand-neutral operations software that makes every shop's *existing* machines smart. We win on refunds, uptime and honest data, not on payment hardware.

---

## 13. Estimated infrastructure cost

**Assumptions:**
- About 10 machines per shop and about 12 cycles per machine per day.
- In "connected" shops, about 60% of machines have sensors.
- Sensors post every 10 s while running and every 60 s idle.
- Only derived events and state intervals are stored long-term; raw samples keep 7 days.

| | **1 laundromat** (pilot) | **10 laundromats** | **100 laundromats** |
|---|---|---|---|
| Load | ~120 cycles/day; ~0.2 msg/s telemetry | ~1.2k cycles/day; ~2 msg/s | ~12k cycles/day; ~20 msg/s peak; ~200 concurrent WebSockets |
| App | 1 × 2 vCPU/2 GB VPS in Singapore or Malaysia running API, Postgres and Caddy together (US$12) | 1 × 2 vCPU/4 GB app VPS (US$24) | 2 × 2 vCPU/4 GB app instances + load balancer (US$60) |
| Database | Same box; nightly `pg_dump` to object storage (US$1) | Managed Postgres, 1 vCPU/2 GB (US$30) | Managed Postgres 4 GB with standby (US$120–150) + read replica later |
| MQTT | Not needed (HTTP ingest) | Mosquitto on the app VPS (US$0) | Dedicated Mosquitto/EMQX VPS or EMQX Serverless (US$15–30) |
| Monitoring, logs, errors | Free tiers (Uptime Kuma, Sentry dev) | US$10–26 | US$40–60 |
| Email (receipts, owner mail) | Free tier | Free tier | US$10–20 |
| Photos (Phase 2) | – | US$2 | US$10 |
| Domain, TLS | ~RM 5/mo (Let's Encrypt free) | same | same |
| **Total/month** | **≈ US$15 ≈ RM 65** | **≈ US$70–90 ≈ RM 300–380** | **≈ US$270–350 ≈ RM 1,100–1,500** (≈ RM 12–15 per shop) |

**Variable costs to watch:**
- **WhatsApp notifications.** Meta charges per template message.
  - At 100 shops, if 30% of cycles opt in and get 2 messages each, that's about 270k messages a month. At about RM 0.05–0.10 each, that is **RM 13k–27k a month**, far more than all the infrastructure combined.
  - Mitigation: web push is the default. The WhatsApp flow is *customer-initiated*: a `wa.me` link with a pre-filled "notify me for W3" message opens a customer-service window, and replies inside that window aren't billed as templates.
  - **Verify Meta's current MY pricing before committing.**
  - WhatsApp becomes a paid add-on above a free quota.
- **Payment fees** pass through to the owner's own merchant account, so they're not our cost.
- **Web push** is free.

---

## 14. Suggested pricing model

**Design goals:**
- A small independent owner can start at **RM 0 and without hardware**.
- Every price step maps to value the owner can see: fewer refund disputes, less downtime, trustworthy cash.
- **No percentage cut of shop revenue.** Owners already resent franchise royalties and QR-vendor MDR mark-ups.

| Plan | Price | Includes | Why |
|---|---|---|---|
| **Starter** | **Free**, 1 shop, up to 12 machines | QR machine pages (instructions in BM/EN/中文), laundry timers and notifications, problem reports to the owner's phone, announcements, today view, tickets | Removes adoption friction. Every sticker also brings customers into the network. Costs us about RM 5/shop/month. |
| **Operator** | **RM 79/shop/month** (RM 69 billed annually) | Multi-branch, analytics and capacity insight, cash collections and reconciliation, maintenance schedules, checklists, refunds queue, staff roles, audit log | Replaces spreadsheets and WhatsApp chaos. About 0.3–0.5% of a RM 16–29k/month shop. |
| **Connected** | **+ RM 10 per sensored machine/month** | Live availability, sensor-verified cycles and evidence on disputes, offline, stuck and short-cycle alerts, silent-machine detection, run-hour maintenance | One silent washer for 3 days (≈ 24 cycles × RM 6 = RM 144) pays for a month of sensors on 14 machines. |
| Sensor kit (hardware) | **≈ RM 180 per machine** (Shelly-class meter + clamp + enclosure), sold near cost; ESP32 kit about RM 120 later | Off-the-shelf, no modification inside the machine | Hardware isn't the profit centre; recurring software is. |
| Installation | **RM 300–500 per shop** through a partner registered electrician | Board-side clamps, Wi-Fi/4G check, QR stickers | Safety and compliance. |
| **Pay-in-app** (Phase 3, optional) | **RM 0.10 per app-paid cycle**, capped at RM 99/shop/month. The owner's own gateway fees (DuitNow QR ≈ 1–1.2%) pass through. | Pay & start with automatic refunds | No % take rate, transparent, capped. |
| **Chain / white-label** | From **RM 1,500/month** + setup | Custom brand and domain, franchise royalty reports, cross-branch benchmarking, SSO, API access | Chains need their own brand. |

**Worked example.** A 10-machine shop, fully connected, costs RM 79 + RM 100 = **RM 179/month**, plus about **RM 2,200 one-time** (kit + install). Laundro claims RM 3.5–8k for a 10-machine QR retrofit plus RM 600–900/month opex, which is a vendor claim. Our retrofit is also *reversible*: it's a clamp at the distribution board.

---

## 15. Risks and failure scenarios

| Risk / scenario | Likelihood | Impact | Mitigation (built or planned) |
|---|---|---|---|
| **Shop internet down** | High | Medium | Machines keep taking coins, so nothing depends on us. Status shows "offline / no live status", never false "available". Pay-in-app is hidden while the device is offline. ESP32 firmware buffers readings. Offer a 4G router add-on. |
| **Our API down** | Low | Medium | The shop still works. Timers keep counting locally in the browser. Jobs are durable in Postgres, so reminders are delayed, not lost. |
| **Payment succeeds but the machine doesn't start** | Medium | High (trust) | **Built:** start only counts when the sensor confirms it; one retry, then automatic refund, a system ticket, and the machine marked faulty so the next customer isn't charged. Late webhooks after expiry are auto-refunded. |
| **Double charge or duplicate webhook** | Medium | High | **Built:** idempotency keys (unique per customer), webhook de-dup table, guarded state transitions, one command per payment. |
| **Sensor misreads** (fill/soak dips, gas dryers, 3-phase machines) | Medium | Medium | Per-device thresholds, long end-debounce for washers, min/max cycle guards. Calibrate on install using the simulator curve. Clamp one phase. |
| **Trolls or false reports** take machines offline | Medium | Medium | **Built:** one report is a warning only. The fault state needs N distinct reporters (default 2). Staff confirm or clear. Rate limits. |
| **Customers don't check in** (Phase 1 data is thin) | High | Medium | The check-in is what gets *them* the notification, so they have their own reason to do it. Counts are labelled "from check-ins". Counter readings at cash collection give exact cycle counts. Sensors fix it properly. |
| **iOS web push** needs the app installed to the home screen | High | Medium | In-page countdown still works. Clear install instructions. WhatsApp is the Phase 2 channel. A native app is Phase 3 if the data justifies it. |
| **QR sticker swapped for a malicious QR ("quishing")** | Low | High | Stickers only point to our domain. The page shows the machine code, which must match the physical label. We never ask for payment outside our domain or the gateway. Tamper-evident stickers. |
| **Electrical safety and warranty** of retrofits | Medium | High | Observation-only clamps at the board, installed by registered electricians (Energy Commission requirements). No modification inside the machine for Phase 2. Control (pulse) only on validated models with the owner's written consent. |
| **Franchise agreements forbid third-party systems** | Medium | Medium | Observation is passive and payment-neutral, which is easier to approve. Offer a franchisor-level deal (white-label and royalty reports). |
| **E-money / regulatory** | Low (by design) | High | No stored value, no wallet, direct-to-merchant settlement. Get legal review before any loyalty "credit". |
| **PDPA (personal data)** | Medium | Medium | Guests are anonymous. Phone numbers are collected only for refunds, masked for staff, and purged after the case closes (Phase 2 job). Hosted in MY/SG. Audit log. |
| **Staff skimming, now detectable** | – | – | This is a *feature*: reconciliation flags shortfalls, and staff can't see analytics. Owners must handle findings sensitively. |
| **Owner adoption stalls** after sign-up | High | High | Free tier, a 30-minute onboarding (bulk-add machines, print stickers), and a weekly WhatsApp/email digest ("3 issues fixed, W4 silent 2 days"). |
| **Single-developer bus factor** | High | High | Boring stack, typed end to end, tests on the critical paths (payments, state, detector), a single deployable, documented runbooks. |
| **Scale limits of on-the-fly analytics** | Low for 18 months | Low | Add hourly rollup tables when a tenant passes about 200 machines. The API stays the same. |

---

## 17. Staged implementation plan

| Stage | Duration | Scope | Exit criteria |
|---|---|---|---|
| **0. Foundations** ✅ | 1–2 wks | Monorepo, schema, state reducer, job queue, event bus, auth/RBAC, audit, CI tests | Critical-path tests green |
| **1. MVP (software-only)** ✅ *built in this repo* | 4–6 wks | Customer PWA (shops, availability with confidence, machine QR page, timers and push, reports, BM/EN/中文); owner dashboard (overview, branch live view, machine detail, tickets, refunds, collections and reconciliation, analytics and capacity insight, maintenance, checklists, announcements, QR sheets, staff, audit); telemetry ingest and detector; pay-and-start pipeline with mock gateway | Demo seed shows every flow; end-to-end browser runs pass |
| **2. Pilot** | 4–8 wks | 2–3 real shops (one coin-only, one with a QR board). Print stickers, train staff. Real CHIP or HitPay sandbox → production. Install Shelly EM sensors on one shop. Calibrate thresholds. Weekly owner digest. | ≥ 30% of cycles checked in, or 100% sensed on the sensor shop; owner opens the dashboard ≥ 4×/week; refund disputes resolved in < 24 h |
| **3. Observation at scale (Phase 2)** | 6–8 wks | MQTT bridge, ESP32 firmware (buffering, OTA), anomaly rules (heater, short cycle, stuck), "notify me when free", WhatsApp channel, optional phone-OTP accounts and receipts, photo uploads, CSV import from QR-board vendors, RLS hardening, PDPA retention job | 10 shops connected; < 1 false offline alert per shop per week |
| **4. Control and monetisation (Phase 3)** | 8–12 wks | Model-by-model pulse-start adapters (validated with technicians), real gateway pay & start, off-peak pricing on controllable machines, loyalty stamps (owner-funded vouchers), family sharing, chain white-label and royalty reports, Tamil | Auto-refund rate < 1% of app-paid cycles; zero unrefunded failed starts |
| **5. Scale** | ongoing | Rollups for analytics, a second region, React Native only if push metrics demand it, partner installer network, franchisor deals | 100+ shops; infrastructure < RM 15 per shop per month |
