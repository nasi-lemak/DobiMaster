# 01 · Discovery: journeys and pain points

This document covers deliverables **1–4**: the customer journey map, the owner journey map, and the top customer and owner pain points.

It is based on how a typical Malaysian self-service dobi works today:

- 6–20 coin- or QR-operated machines, often unattended.
- Front-load washers in several capacities (roughly 8–10 kg, 12–15 kg, 18–20 kg, and 25–30 kg "comforter/selimut" washers).
- Stacked or single gas or electric dryers.
- A note/coin changer, sometimes a detergent vending machine.
- A "call/WhatsApp this number" sticker on the wall.

Many shops are open 24 hours, and many are franchise units. A large share of visits involve bulky items like comforters, curtains and prayer mats, or people who don't have a dryer at home. Those customers are tied to the *largest* machine in the shop, and there is usually only one or two of those.

> **Rule used throughout.** For every feature we ask: *"What real-world problem at a laundromat does this solve?"* If there's no strong answer, the feature is cut. See [02-product.md](02-product.md) for the result.

---

## 1. Customer journey map

Legend: 😊 fine · 😐 friction · 😠 real pain · 💡 opportunity

| Stage | What the customer does | What goes wrong today | Emotion | Opportunity |
|---|---|---|---|---|
| **1. Decide** | Looks at the pile, or the comforter that won't fit the home machine. Thinks "is the dobi open, and is the big washer free?" | No way to know from home. Google Maps hours are often wrong. Prices and machine sizes are unknown for a new shop. | 😐 | 💡 Shop page: hours, prices by size, facilities, *"usually quiet now"*. Live counts where a sensor exists. |
| **2. Travel** | Drives or rides 5–15 minutes, often carrying 2–3 bags. | Arrives to find every washer busy, or the one large washer has a handwritten "ROSAK" sign on it. The trip is wasted. | 😠 | 💡 Live availability per capacity class. Owner-marked "out of order" is visible *before* leaving home. |
| **3. Arrive and find a machine** | Scans the room for a free machine of the right size. | A machine looks idle but still has someone's finished laundry inside. Can't tell which machines are broken. Unsure whether to remove a stranger's clothes. | 😠 | 💡 Machine state *"finished 12 min ago, not yet collected"*. Shop policy on removing clothes shown clearly. |
| **4. Understand** | Reads the faded sticker. Works out the program, whether detergent is automatic, and how much fits. | Instructions are English- or Chinese-only. It's unclear whether detergent is auto-dosed, so people add their own (overdosing, suds errors). They overload the machine. | 😐 | 💡 Scan the QR on the machine to get instructions in BM, English, Chinese (Tamil later): capacity, recommended load ("≈ 1 queen comforter"), and whether detergent/softener is auto-dosed. |
| **5. Pay** | Coins, notes changer, or a QR on the machine. | The changer is empty or rejects old notes. The coin is "eaten". QR payment is deducted but the machine doesn't start, and nobody is there. | 😠 | 💡 One-tap problem report tied to the exact machine and time. Where the machine is controllable, pay in the app with an **automatic refund if the start isn't confirmed**. |
| **6. Wait** | 25–45 min per wash, 30–50 min per dry. Either sits in a hot shop or leaves. | Doesn't know exactly when it will finish. Comes back too early, or too late (blocking the machine; clothes get moved or stolen). | 😐 / 😠 | 💡 A timer started by scanning the QR. Push notifications at *5 minutes left* and *finished*, plus a reminder if not collected. |
| **7. Transfer to the dryer** | Moves wet laundry to a dryer. | All dryers are busy (dryers are the usual bottleneck). The dryer runs but doesn't dry (clogged lint filter, weak burner), so they pay again. | 😠 | 💡 Dryer availability and a *"notify me when a dryer frees up"* request (Phase 2). Report "dryer not drying" linked to the machine. The owner sees repeat reports. |
| **8. Collect and leave** | Folds and leaves. | Forgets items. Has no receipt. Problems are reported by WhatsApp to a personal number and resolved days later, or never. | 😐 | 💡 "Collected" tap ends the reminders. Digital receipt for app payments. Report status visible to the reporter. |
| **9. After** | Repeat visits. | No reason to prefer one shop over another except distance. | 😊 | 💡 Light loyalty (Phase 3). Its value is small next to reliability. |

**Key insight:** the pain points are mostly about **uncertainty** (is it free, is it broken, when is it done, will I get my money back) and **helplessness in an unattended shop**. They aren't about payment convenience. A cashless-payment app alone solves the least painful part of the journey.

## 2. Owner journey map

The typical owner runs one to five shops, often as a side business. Many run franchise units with royalty reporting.

| Cadence | Activity | How it's done today | Pain | Opportunity |
|---|---|---|---|---|
| **Continuous** | Know whether the shop is OK | Drives by. Watches CCTV on their phone. Waits for customer WhatsApps. | 😠 Has to *be there* to know. CCTV shows people, not machine health. | 💡 One screen for all branches: what's running, what's down, open issues, today's revenue. |
| **Continuous** | Handle complaints | Personal WhatsApp at 11 pm: *"machine eat my RM10"*. Asks for photos, guesses which machine, transfers a refund by DuitNow. | 😠 No evidence, no record, and it interrupts personal time. Refund fraud is possible. | 💡 Structured reports tied to the machine by QR, with timestamps. A refund queue with evidence (was the machine observed running?). |
| **Daily** | Cleaning, lint filters, restocking detergent, emptying bins | A part-time cleaner. The owner has no idea whether it happened. | 😐 Cleanliness complaints hurt ratings. Lint build-up is a fire risk. | 💡 A cleaning checklist done on the staff phone, time-stamped. The owner sees completion remotely. |
| **Daily to weekly** | Coin collection | Opens each machine's coin box and counts totals, rarely per machine. | 😠 No per-machine revenue. Skimming is hard to detect. A coin mechanism jammed for days goes unnoticed. | 💡 Per-machine collection log with an optional **cycle-counter reading**. Expected vs. actual cash shows discrepancies. |
| **Weekly** | Machine problems | Finds out when a customer complains or a cleaner mentions it. Calls a technician. Tapes on a "ROSAK" sign. | 😠 Silent failures lose revenue for days. Downtime is never measured. | 💡 Mark a machine out of order remotely (customers see it before travelling). Downtime tracking. Alerts when a machine has unusually low usage or repeated faults. |
| **Monthly** | Preventive maintenance: descaling, belts, door seals, dryer ducts | Memory, or a paper log in the shop. | 😐 Missed maintenance leads to expensive breakdowns and fire risk. | 💡 Schedules by calendar, cycles or run-hours, with due alerts and history per machine. |
| **Monthly** | Revenue and utilities; franchise royalty report | Spreadsheet from coin counts and the QR-provider portal. | 😐 Manual reconciliation across sources. | 💡 One revenue view across cash, app and QR sources, by shop, machine, type and period. |
| **Quarterly** | Pricing, promotions, capacity: *"should I add another dryer?"* | Gut feeling. | 😐 Expensive decisions (RM 8k–25k per machine) made without data. | 💡 Utilisation by capacity class and saturation hours (the share of open hours when every machine in the class was busy), with a payback estimate. |

**Key insight:** owners mostly need **remote awareness and trustworthy records**. That's a question of *observing* existing machines, which is possible without replacing them. Control (remote start) is a smaller, riskier, machine-specific add-on.

## 3. Top customer pain points (ranked)

Ranked by **frequency × severity**, with the root cause and whether software alone (Phase 1) can help.

| # | Pain point | Root cause | Software alone? | With a cheap sensor |
|---|---|---|---|---|
| 1 | **Wasted trip**: everything is busy, or the needed large washer is broken | No remote visibility | Partly: out-of-order flags, "usually busy now" | ✅ Live availability by capacity |
| 2 | **Money lost, no one to help**: coin eaten, or QR deducted and the machine didn't start | Unattended shop, no evidence | ✅ One-tap machine-linked report, refund workflow | ✅ Sensor evidence; automatic refund where the app controls the start |
| 3 | **Not knowing when laundry is done** | No timer or notification | ✅ QR-started timer with push notifications | ✅ Exact start and end from power data |
| 4 | **Machines blocked by uncollected laundry**, and awkwardness about removing it | No signal to the owner of the laundry, no stated policy | ✅ Reminders to the owner of the laundry; shop policy shown | ✅ "Finished but not emptied" state (door or power pattern) |
| 5 | **Dryers not drying**, paying twice | Clogged lint, poor maintenance | Partly: reports and repeat-fault alerts | ✅ Low-current or short-cycle anomaly detection |
| 6 | **Dirty machines, dirty shop** | No cleaning accountability | ✅ Checklists and cleanliness reports | — |
| 7 | **Unclear instructions, overloading, detergent confusion** | Stickers, one language | ✅ Multilingual machine page | — |
| 8 | **Waiting for a dryer or washer** | Capacity mismatch at peak | Partly: "usually quiet at 2 pm" | ✅ "Notify me when free" |
| 9 | **No change, no cashless option** | Coin-only machines | ❌ Needs a payment device | ✅ With control hardware (Phase 3) |
| 10 | **No receipt or history** | Cash | ✅ For app payments | — |

## 4. Top owner pain points (ranked)

| # | Pain point | Software alone? | With a cheap sensor |
|---|---|---|---|
| 1 | **Has to visit or call to know whether the shop is OK** | Partly: tickets, checklists, customer reports | ✅ Live machine state, offline alerts |
| 2 | **Silent machine failures** (jammed coin mechanism, tripped breaker, broken dryer burner) losing revenue for days | Partly: meter readings reveal zero-usage machines at collection | ✅ Low-usage and "no cycles today" alerts within hours |
| 3 | **Complaints and refunds by personal WhatsApp**, with no evidence and possible fraud | ✅ Structured reports and a refund queue | ✅ Power-trace evidence per report |
| 4 | **No per-machine revenue or utilisation**, so pricing and expansion decisions are guesswork | Partly: per-machine collections and meter readings | ✅ Exact cycles per machine, per hour |
| 5 | **Cash reconciliation and skimming risk** | ✅ Expected (cycles × price) vs. collected | ✅ |
| 6 | **Cleaning and maintenance accountability** | ✅ Checklists, schedules, history | ✅ Run-hours-based maintenance |
| 7 | **Communicating with customers** (closures, broken machines) | ✅ Announcements on the shop page | — |
| 8 | **Multi-branch overview and franchise reporting** | ✅ | ✅ |
| 9 | **Vendor lock-in**: smart laundry needs expensive new machines or proprietary payment boxes | ✅ This product's premise | ✅ Off-the-shelf sensors |

## 5. Design principles derived from the above

1. **The shop must still work exactly as before.** Walk in, put in coins, wash. The app is additive and never a gate. No mandatory account, no mandatory install. Scanning a QR opens a web page.
2. **Honest data.** Every machine state carries its *source*: sensor, customer, staff, or none. The UI never shows "Available" with sensor-level confidence when nobody knows. In an unsensored shop the customer sees *"no live status; usually quiet at this hour"*, not fake counts.
3. **Observe first, control later, and only where safe.** Monitoring works on nearly every machine. Starting a machine electronically is per-model, per-installation, and opt-in.
4. **The owner's phone is the dashboard.** Owners check between other jobs, so the owner UI is mobile-first and responsive to desktop.
5. **Cheap by default.** Zero hardware in Phase 1. Off-the-shelf energy monitors (about RM 60–200 per machine) in Phase 2. Custom hardware only where the off-the-shelf option fails.
6. **Records over opinions.** Timestamps, audit logs and evidence settle disputes (refunds, cleaning, staff) without the owner being present.
