# 02 · Product: feature ranking, non-goals and wireframes

This document covers deliverables **5, 6 and 12**. Every feature lists the problem it solves. Where the answer was weak, the feature was moved later or cut.

Status sources referenced below:
- **C**: customer check-in (a customer scans the QR and taps *Start timer*)
- **S**: staff action
- **I**: IoT sensor (Phase 2)
- **P**: app payment on a controllable machine (Phase 3)

---

## 5. Features ranked

### MVP (Phase 1): software only, works with any machine

| Feature | Real-world problem solved | Notes |
|---|---|---|
| **Nearby dobi list and shop page** (hours, open now, prices by size, facilities, detergent auto-dosed?, announcements) | Wasted trips; unknown prices and sizes; wrong Google hours | No login. Distance from browser geolocation. |
| **Availability with honest confidence** (counts per washer or dryer class, labelled by source) | "Is the big washer free / working?" | Sensor-backed later; in Phase 1 it comes from C + S sources plus out-of-order flags. |
| **"Usually busy at this time"** (hour-of-week profile) | Choosing when to go | Built from cycle history of all sources. Needs about 2 weeks of data. |
| **Machine QR page** (`/m/{code}`): size, price, programs, recommended load, detergent info, instructions in BM/EN/ZH | Unclear instructions, overloading, detergent confusion | QR is a URL, so any phone camera works. No app install. |
| **Laundry timer from the QR** (guest), with push at *N min left*, *finished*, and *uncollected* reminders; "Collected" tap | Not knowing when laundry is done; blocked machines | The customer's own benefit is the incentive to check in, and each check-in also feeds shop availability. |
| **"Finished, not collected" state** shown to the next customer, with the shop's clothes-removal policy | Awkwardness and conflict over others' laundry | Policy text is set by the owner. |
| **Problem report linked to the machine** (not starting, payment deducted, dirty, leak, dryer not drying, damaged, abandoned clothing, cleanliness, other) with optional DuitNow phone for refund | Lost money in an unattended shop; slow WhatsApp complaints | Auto-links shop, machine, time and the reporter's active cycle. Guest-friendly. |
| **Multi-signal fault logic**: one report shows a warning; two independent reports (configurable) mark the machine *Fault (reported)*; staff confirm or clear | Trolls shouldn't be able to take a machine down, but real faults must surface fast | |
| **Multilingual UI**: Bahasa Melayu, English, 中文 (Tamil-ready) | Mixed-language customer base | Machine instructions are per-language fields, with fallback. |
| **Owner overview** (all branches: running now, offline, open faults, revenue today, utilisation today, items needing action) | Having to visit the shop to know its state | No vanity metrics. |
| **Machine inventory and QR generation** (printable sticker sheet per shop) | Machine identification; linking reports to machines | Short human code on the sticker too (e.g. `W3`). |
| **Manual state control**: maintenance, disabled, back in service, with a reason shown to customers | "ROSAK" paper signs; customers travelling for a broken machine | Audit-logged. |
| **Tickets**: customer and staff issues, status workflow, assignment, repeat-fault alert | Complaints lost in WhatsApp; no fault history | |
| **Refund queue** (request, approve or reject, pay by DuitNow/cash/original method, reference recorded) | Unverifiable manual refunds | Linked to the ticket and machine; evidence shown. |
| **Cash collection log** per machine, with optional cycle-counter reading | No per-machine revenue; skimming; jammed coin mechanisms | Expected vs. actual comparison when counter readings exist. |
| **Revenue and utilisation analytics** by shop, machine, type, capacity, hour, day, week and month; peak-hour heatmap; washer vs. dryer; low-usage detection; capacity insight ("add a dryer?") | Expansion and pricing guesswork | Sources: collections, meter readings, app payments, check-in cycles. Each chart states its data sources. |
| **Maintenance schedules** by calendar, cycles or run-hours; maintenance log; due alerts | Missed preventive maintenance, fire risk from lint | Counters come from any cycle source. |
| **Cleaning checklist** (templates per shop, daily/per-shift, tick-off with who and when) | "Did the cleaner actually come?" | Photo proof is Phase 2. |
| **Announcements** (per shop, time-bounded, multilingual) | Communicating closures and broken machines | Shown on the shop page. |
| **Staff roles** (owner, manager, staff; branch-scoped) and **audit log** | Accountability; staff shouldn't see revenue | |
| **Owner alerts** (repeated faults, low usage, maintenance due, device offline) as a list plus web push | Silent failures | |
| **Device telemetry ingest and cycle detector** (HTTP; generic power-monitor adapter; simulator) | Groundwork for Phase 2 sensors | Built in the MVP so a pilot shop can plug in an off-the-shelf energy monitor immediately. |
| **Pay-and-start pipeline with a mock gateway and simulated controller** (idempotent payments, start confirmation, **automatic refund if the start isn't confirmed**) | "Payment deducted but machine not running" | Ships behind a per-machine capability flag, so nothing changes for coin machines. Real gateways plug into the same interface. |

### Phase 2: cheap observation hardware and engagement

| Feature | Problem solved |
|---|---|
| **Off-the-shelf energy monitors** (Shelly Plus 1PM / Pro EM with clamp, or an ESP32 with CT clamp) per machine; MQTT ingest; vendor adapters | Accurate live state without replacing machines |
| **Device offline and heartbeat alerts**, power-cut detection | Tripped breakers and internet outages noticed within minutes |
| **Anomaly rules**: dryer cycle with abnormally low heater current, an optional exhaust-temperature probe for LPG dryers (a clamp can't see the burner), washer stuck mid-cycle | Silent failures; "paid 40 min, it ran 26" (the short-cycle alert is already in the MVP) |
| **"Notify me when a washer/dryer frees up"** (a notify-list, not a queue) | Waiting in the shop |
| **WhatsApp "notify me"**: customer-initiated `wa.me` link with a pre-filled machine code, answered in the free customer-service window; paid templates only above a quota. Plus an **iOS install prompt**. | iOS web push requires Add to Home Screen. WhatsApp is Malaysia's default channel. Keeps per-message cost under control (see 04-business §13). |
| **Optional customer accounts** (phone OTP), cross-device history, receipts | Receipts and history beyond one device |
| **Photo attachments** on reports and checklists | Evidence for leaks, dirt, damage; proof of cleaning |
| **CSV/API import from existing QR-payment providers** | Revenue reconciliation without switching provider |
| **Staff shift and task scheduling**, technician contacts | Assigning work across branches |
| **Postgres row-level security** as defence-in-depth for tenancy | Security hardening |

### Phase 3: control and monetisation (machine-specific, opt-in)

| Feature | Problem solved |
|---|---|
| **Pay and start in app** via real gateways (DuitNow QR, FPX, cards, e-wallets) on machines with a verified safe control path (coin-pulse interface, vendor API, Modbus) | Cashless; no coins or change |
| **Off-peak promotional pricing** (time-window rules) | Flatten peaks, fill quiet hours. Only works where the app sets the price. |
| **Loyalty** (stamp card funded by owner, voucher redemption, no stored value) | Retention without e-money licensing |
| **Family/shared accounts** (shared history and notifications for a household) | Several people doing laundry for one household |
| **Chain/franchise features**: white-label, royalty reports, cross-branch benchmarking | Chain operations |
| **React Native app** (only if PWA limits hurt: iOS push, background location) | Notification reliability |
| **Tamil** UI translation | Wider reach |

## 6. Features we should NOT build initially

| Not building | Why |
|---|---|
| **Stored-value wallet / top-up balance** | Holding customer funds is e-money issuance, regulated by Bank Negara Malaysia. It also creates refund liabilities and trust issues. Pay per cycle instead. |
| **Hard reservations or booking of machines** | Walk-in customers don't see or respect app bookings, so a reserved machine sits idle while a walk-in waits next to it, and conflicts follow. Use "notify me when free" instead. |
| **Remote start on unverified machines** | Safety (door lock, water, heat), warranty, fraud. Observation first. |
| **Mandatory registration or app install** | Kills the "walk in and wash in 30 seconds" flow. |
| **Pickup and delivery / wash-and-fold marketplace** | A different business (logistics); Cents and CleanCloud already serve it. |
| **In-app chat between customer and owner** | Tickets plus a WhatsApp deep link cover it without a moderation burden. |
| **AI "predictive maintenance"** | No data yet. Rules (cycles, run-hours, anomalies) first. |
| **Custom PCB hardware** | Off-the-shelf monitors first. Design custom hardware only where they fail. |
| **Microservices, Kubernetes, event-sourcing everything** | A solo developer needs one deployable. A modular monolith with clear boundaries is enough. |
| **Gamification, social feeds, ratings of other customers** | Doesn't solve any laundromat problem. |
| **Detergent vending integration** | Low value; varies by vendor. |
| **Dynamic surge pricing** | Hurts trust in a neighbourhood business. Off-peak *discounts* only (Phase 3). |

---

## 12. Wireframes (descriptions)

The customer screens are mobile-first (360–430 px). The owner screens are mobile-first and expand to a sidebar layout at ≥ 1024 px. The language switcher is always in the top bar (BM · EN · 中文).

### Customer

**C1 · Home / nearby dobi** (`/`)
```
┌──────────────────────────────┐
│ DobiMaster          BM EN 中 │
│ [📍 Using your location]     │
│ ┌──────────────────────────┐ │
│ │ Dobi Ceria SS2   0.8 km  │ │
│ │ ● Open 24h               │ │
│ │ Washers 3/8 free (live)  │ │
│ │ Dryers  4/6 free (live)  │ │
│ │ Usually quiet now        │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ Dobi Ceria Damansara 2km │ │
│ │ ● Open · closes 11pm     │ │
│ │ No live status           │ │
│ │ Usually busy now         │ │
│ │ ⚠ 1 machine out of order │ │
│ └──────────────────────────┘ │
│ [Scan machine QR]            │
└──────────────────────────────┘
```
- One card per shop, sorted by distance. Location permission is optional; without it, sort by name or area.
- Counts are only shown with a source label: *live* (sensor) or *from check-ins*.

**C2 · Shop detail** (`/s/{slug}`)
- Header: name, address (opens Google Maps or Waze), hours, open-now state, WhatsApp contact button.
- Announcements banner (e.g. "Dryer 2 under repair until Fri").
- **Availability by class**: rows like `Washer 10 kg · 2 of 4 free · RM 5`, `Washer 20 kg (comforter) · 0 of 1 free · finishes in ~12 min`, `Dryer · 4 of 6 free · RM 1 / 7 min`.
- **Busyness chart**: today's hourly bars with a "now" marker.
- Machine grid (tiles coloured by state; the text label is always shown, not colour alone).
- Facilities: detergent auto-dosed ✓, softener ✓, change machine, Wi-Fi, parking, CCTV, 24h.
- Shop policy: "Laundry left 15 min after finishing may be moved to the basket."

**C3 · Machine page (QR landing)** (`/m/{code}`). This is the most important screen.
```
┌──────────────────────────────┐
│ ← Dobi Ceria SS2             │
│ WASHER W3 · 12 kg            │
│ ● Available                  │
│ Fits ≈ 1 queen comforter or  │
│ 2 full baskets               │
│ 🧴 Detergent & softener are  │
│    added automatically       │
│ Programs:  Cold 30m RM5      │
│            Warm 35m RM6      │
│            Hot  40m RM7      │
│ ─── How to use ───           │
│ 1. Load, close door firmly   │
│ 2. Insert coins / pay QR     │
│ 3. Choose program, press ▶   │
│                              │
│ [ ⏱ I've started it — notify │
│     me when done ]           │
│ [ 💳 Pay & start in app ]    │ ← only if machine is controllable
│ [ ⚠ Report a problem ]       │
└──────────────────────────────┘
```
- If running: shows remaining time ("~14 min left"), with no personal data.
- If finished and not collected: "Finished 12 min ago, laundry may still be inside" plus the shop policy.
- If fault or maintenance: a red banner with the reason, and the timer and pay buttons hidden.

**C4 · Start timer sheet**: pick the program (pre-selected default) and confirm. The browser asks for notification permission *at this moment*, because the user can see why. On iOS without install, it shows "Add to Home Screen to get alerts" and keeps an in-page timer as a fallback.

**C5 · Active laundry** (`/me`)
- A big countdown per active cycle ("Washer W3 · 7:42 left").
- Buttons: *I've collected my laundry* · *Report problem* · *Cancel timer*.
- After finishing: "Finished. Please collect so others can use the machine."
- History (this device): past cycles, app payments with receipts.

**C6 · Report a problem** (`/m/{code}/report`)
- Large icon buttons for the categories. Optional details text. Optional "amount lost (RM)" and DuitNow phone number for categories involving money.
- On submit: a reference number (e.g. `T-2481`) and a status link.

**C7 · Pay and start** (controllable machines only): program → price → method (DuitNow QR / FPX / card / e-wallet) → gateway → "Starting machine…" (waits for confirmation) → "Running" or "We couldn't start the machine. Your RM 6.00 is being refunded automatically (ref …)".

### Owner

**O1 · Overview** (`/owner`)
```
┌──────────────────────────────────────────┐
│ Today · all branches                      │
│ ┌───────┐┌───────┐┌───────┐┌──────────┐  │
│ │RM 842 ││ 11/38 ││ 2     ││ 3 need   │  │
│ │revenue││running││offline││ action   │  │
│ └───────┘└───────┘└───────┘└──────────┘  │
│ Needs attention                           │
│  🔴 SS2 · W3 fault: 2 reports "not start" │
│  🟠 Damansara · refund RM 10 pending      │
│  🟠 SS2 · D2 maintenance due (lint duct)  │
│  🟡 Kepong · W5 0 cycles since yesterday  │
│ Branches                                  │
│  SS2        ●6 running ○1 fault  RM 402   │
│  Damansara  ●3 running           RM 281   │
│  Kepong     ●2 running ◌ no sensors RM159 │
└──────────────────────────────────────────┘
```
- The "needs attention" list is the core: faults, pending refunds, offline devices, overdue maintenance, low-usage anomalies, and checklists not completed today.
- Each item is one tap from its resolution screen.

**O2 · Branch live view** (`/owner/shops/{id}`): machine grid (state, source, time in state, current cycle remaining). Tapping a machine opens O3. Today's checklist status. Open tickets.

**O3 · Machine detail**: state and a history timeline (state changes, cycles, tickets, maintenance). Actions: *Mark maintenance* / *Disable* / *Return to service* (reason required) / *Print QR*. Stats for the last 30 days: cycles, revenue, utilisation, downtime hours. Maintenance plans and when each is due.

**O4 · Tickets** (`/owner/tickets`): filter by status, branch and category. A detail page with a timeline, assignment, status changes, internal notes, linked machine, cycle and payment, and a *Create refund* button.

**O5 · Refunds** (`/owner/refunds`): pending first. Approve or reject, choose payout method (original payment, DuitNow transfer, cash), and record the reference.

**O6 · Revenue and analytics** (`/owner/analytics`)
- Filters: branch, period (today, 7 days, 30 days, month), group by (day, week, month, hour, machine, type, capacity).
- Revenue over time (stacked by source: cash, app, QR import).
- Utilisation: washer vs. dryer; per machine with low-usage flags.
- Peak-hour heatmap (day of week × hour).
- **Capacity insight**: per class, average and peak utilisation, saturation hours (% of open hours with every machine of the class busy), revenue per machine per month, and a payback estimate for adding one more machine.
- Every panel shows a "data sources" footnote so the owner knows what the figures are based on.

**O7 · Collections** (`/owner/collections`): *Record collection* form per shop (a row per machine: amount RM, optional counter reading), history, and a discrepancy view (counter delta × price vs. amount collected).

**O8 · Maintenance** (`/owner/maintenance`): plans (machine or type scope, trigger: every N days / N cycles / N run-hours), a due list, and *Log maintenance done*.

**O9 · Checklists** (`/owner/checklists`): templates per shop, and today's run with items ticked by whom and when. The staff view on a phone is a large tick list.

**O10 · Machines and QR** (`/owner/machines`): list, add or edit (type, capacity, programs, instructions per language, capabilities), and a printable **QR sticker sheet** (A4 grid; each sticker shows the QR, the machine code in large type, and "Scan for timer, help & instructions").

**O11 · Announcements, shop settings, staff, audit log**: straightforward CRUD screens. The audit log is read-only and filterable by user, entity and date.
