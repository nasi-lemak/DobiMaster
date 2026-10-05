# DobiMaster

**Smart-laundromat capabilities for existing self-service dobi, without replacing the machines.**

For customers:
- See which dobi nearby is open and has a free machine of the right size.
- Scan the QR on any machine to get instructions in Bahasa Melayu, English or 中文.
- Get told when the laundry is almost done and when it's finished.
- Report a problem in two taps.

No app install and no sign-up.

For owners:
- One screen answers "is everything OK at my shops, and what needs me?"
- Tickets, refunds, cash reconciliation, maintenance, cleaning checklists and capacity analytics.
- It starts with software only. Adding a cheap off-the-shelf power sensor per machine turns check-in-based status into live, sensor-verified status.

## Design documents

| Doc | Contents |
|---|---|
| [docs/01-discovery.md](docs/01-discovery.md) | Customer and owner journey maps, top pain points, design principles |
| [docs/02-product.md](docs/02-product.md) | Features ranked MVP / Phase 2 / Phase 3, what **not** to build, wireframes for every screen |
| [docs/03-architecture.md](docs/03-architecture.md) | Domain model, API, real-time events, IoT (observe vs. control), payments |
| [docs/04-business.md](docs/04-business.md) | Competitor comparison, infrastructure cost (1/10/100 shops), pricing, risks, staged plan |
| [docs/LEGAL-REVIEW.md](docs/LEGAL-REVIEW.md) | Briefing for the lawyer reviewing the privacy notice and terms: data actually processed, retention, open PDPA questions |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Putting it online: server, domain, HTTPS, backups, updates, restores |
| [docs/INSTALL-sensors.md](docs/INSTALL-sensors.md) | What hardware to buy (home test kit, pilot shop); installer checklist: choosing Shelly models, DB/clamp installation, connecting, verifying a first cycle, troubleshooting |
| [docs/research/competitor-research.md](docs/research/competitor-research.md) | Sourced market research: Malaysian QR retrofit vendors, chains, payment rails, complaints |

## What's in the MVP

| Area | Built |
|---|---|
| **Customer PWA** (`/`) | Nearby shops with availability per washer/dryer, labelled by confidence (live / partly live / from check-ins); "usually busy now" profile; shop page (hours, prices by capacity, facilities, announcements, directions, WhatsApp); **machine QR page** (`/m/:code`); laundry timer with push at *N min left*, *finished* and *still not collected*; "collected" frees the machine; problem reports (auto-linked to the machine, the reporter's cycle and payment); pay & start on controllable machines with a receipt; BM / EN / 中文 (Tamil-ready); offline-tolerant (idempotent retries, local countdown, cached shell) |
| **Owner dashboard** (`/owner`) | Overview with a needs-attention list; branch live view; machine detail and timeline; tickets; refunds; cash collections and reconciliation; analytics (revenue, utilisation, peak-hour heatmap, capacity insight, low usage); maintenance plans (days / cycles / run-hours); checklists; announcements; QR sticker sheets; sensors; staff and roles; audit log |
| **Backend** | Fastify + Postgres modular monolith; a single machine-state reducer with honest sources; durable job queue (reminders, timeouts, sweeps); Postgres LISTEN/NOTIFY → WebSocket fan-out; RBAC with branch scoping; audit log; power-based cycle detector with vendor adapters (generic, Shelly); **payment pipeline with idempotency, signed-webhook de-dup, start confirmed by sensor or auto-refund**; mock gateway and simulated controller |
| **Alerts** | Repeated faults, sensor offline, stuck cycle, short cycle ("paid 40 min, ran 26"), silent / low-usage machine, maintenance due, failed start |
| **Notifications** | Web push, plus **WhatsApp "notify me"**. The customer taps a button that opens WhatsApp with a one-time code pre-filled and presses send. That links their number and opens WhatsApp's free 24-hour reply window, so laundry alerts cost nothing and work on iPhones without installing the web app. The inbound webhook is signature-verified. STOP/START is supported. Nothing is sent outside the window except approved templates. |
| **Weekly owner summary** | Every Monday at 08:00 local time: last week's cycles, revenue (owners and managers only), utilisation, out-of-service hours, reports, checklists and a ranked "needs you" list, by email (and WhatsApp if linked). It's also browsable by week at `/owner/digest`, with opt-out and "send me now". |
| **Photos** | Customers can add up to 3 photos to a report. Checklist items can require a photo as proof of cleaning. Photos are resized and re-encoded on the phone, which strips EXIF/GPS. The server accepts JPEG/PNG/WebP by magic bytes only. Photos are served only to owners with access to that shop. |
| **Self-serve sign-up** | *Create an account* on the sign-in page sets up a new business and signs you in. A four-step wizard (`/owner/setup`) follows: (1) the shop, with name, address, "use my location", 24 h or daily hours, WhatsApp and facilities; (2) machines from size presets ("3 × Washer 10 kg"), with editable prices, detergent/softener-auto and a preview of the codes (W1–W3, D1–D2); (3) the QR sticker sheet; (4) go live. Each shop starts hidden from customers. It gets a starter cleaning checklist and maintenance reminders. Progress is worked out from real data, and the Overview page shows "Finish setting up (x of 4)" until you're done. |
| **Owner accounts** | One server-side session per signed-in device. Logout ends it for real. *Account & devices* (`/owner/security`) lists devices, signs out others, and changes your password (which also signs out other devices). *Forgot password?* emails a single-use 30-minute link, without revealing whether an account exists. Removing a staff member ends their access immediately. |
| **"Notify me when free"** | At shops where the machine class is fully sensored, a customer can wait for, say, a 15 kg washer. Each machine that frees up notifies exactly one waiting customer, in order, so a single free machine doesn't send five people rushing over. Nothing is reserved. |
| **Shelly sensors** | An on-device script ([`devices/shelly/dobimaster-sensor.js`](devices/shelly/dobimaster-sensor.js)) for Shelly EM Gen3 / Pro EM / Plus 1PM / PM Mini / Plus Plug UK. It reports every 10 s while running, sends a heartbeat every 60 s when idle, buffers about 10 minutes through Wi-Fi drops, handles a reversed clamp, and supports two machines per EM. Registering a Shelly sensor shows the script with its URL, token and channel filled in. It is tested against a simulated Shelly end to end, **not yet on a physical device**. The installer checklist is [docs/INSTALL-sensors.md](docs/INSTALL-sensors.md). |
| **Sensor analytics** | Energy is measured per cycle. *Electricity per cycle* in Analytics multiplies it by the shop's tariff (Shop settings) to give cost and share of price per machine. The demo data shows dryers at about 24% vs washers at about 5%. A whole shop's sensors going silent together raises one "power / internet outage" alert instead of one per machine. A dryer drawing far less power than its own usual raises "heater may be failing". |
| **Privacy (PDPA)** | **Privacy notice and terms of use** at `/privacy` and `/terms` (drafts, pending legal review). They are in BM, EN and 中文 (the PDPA requires BM and English), linked from every customer page and from owner sign-up, which records the version accepted. **"Delete my data on this phone"** (My laundry) erases a customer immediately; the shop keeps its records, unlinked from the person. A daily sweep removes refund phone numbers 90 days after a case closes, report photos after 180 days and inactive WhatsApp numbers after 180 days, and keeps the WhatsApp message log for 30 days. |

## Run it locally

Prerequisites: Node 22, pnpm 10, PostgreSQL 16.

```bash
pnpm install
psql -c "CREATE ROLE dobi LOGIN SUPERUSER PASSWORD 'dobi'"   # matches apps/api/.env.example
createdb -O dobi dobimaster && createdb -O dobi dobimaster_test
cp apps/api/.env.example apps/api/.env

pnpm --filter @dobi/api seed      # migrates, then loads 3 demo shops + 5 weeks of history
pnpm --filter @dobi/api dev       # API on :3000
pnpm --filter @dobi/web dev       # web on :5173 (proxies /api and /ws)
```

Try the following:
- **Customer:** http://localhost:5173 → open a shop → tap a machine. Or go straight to the machine page for SS2 W3: http://localhost:5173/m/demo-ss2-w3
- **Pay & start** (mock gateway, simulated machine): http://localhost:5173/m/demo-ss2-w1
- **New owner:** http://localhost:5173/owner/signup. Sign up and walk the setup wizard.
- **Owner:** http://localhost:5173/owner, using one of these accounts:
  - `owner@dobiceria.my` / `demo1234`
  - `manager@dobiceria.my` / `demo1234`
  - `staff@dobiceria.my` / `demo1234` (SS2 only, no revenue)
- **Fake a sensor:** `pnpm --filter @dobi/api simulate -- --token demo-dobi-ceria-ss2-W4 --minutes 2`. Then watch W4 go running → finished live in both UIs.
- **WhatsApp (mock):** start a timer, then on *My laundry* tap "Notify me on WhatsApp" and "Dev: simulate sending…". Outbound messages are logged in the `wa_messages` table.
- **Weekly summary:** http://localhost:5173/owner/digest. "Send me now" logs the email to the API console unless `SMTP_URL` is set.

The demo covers three realities:
- **SS2:** every machine has a (simulated) sensor, and W1/W2 support pay-in-app.
- **Damansara Uptown:** no sensors. Status comes only from check-ins; W4 is under maintenance; W2's cash shows a shortfall against its counter.
- **Kepong:** mixed. One sensor is offline, and W4 has gone silent (possibly a jammed coin mechanism).

### Tests

```bash
pnpm --filter @dobi/api test      # unit + integration tests against dobimaster_test
pnpm -r typecheck
```

The integration tests cover:
- the timer and notification lifecycle
- merging a check-in with a sensor-detected cycle
- offline detection and recovery
- the fault threshold
- pay → sensor-confirmed start
- auto-refund when a start isn't confirmed
- duplicate and forged webhooks
- RBAC and tenant isolation
- cash reconciliation
- sign-up and the setup wizard (codes continue across batches, go-live needs machines, tenant isolation)
- production safety (refusing unsafe settings, sign-up modes, payments switched off)

Browser end-to-end tests (Playwright, 30 tests) run on an isolated stack: database `dobimaster_e2e` (created with `createdb -O dobi dobimaster_e2e`), API on :3100 and web on :5180. The database is reseeded on every run.

```bash
pnpm --filter @dobi/web test:e2e
```

### Deploy

**[docs/DEPLOY.md](docs/DEPLOY.md)** is the step-by-step guide to putting DobiMaster online on one rented server:
- domain, server and DNS,
- one setup command,
- email, uptime alerts and backups,
- updates and restores.

The server bundle is in [`deploy/`](deploy): Docker Compose with Postgres, the app, Caddy (automatic HTTPS) and nightly backups, plus setup, update, backup and restore scripts.

A production server refuses to start with unsafe settings:
- a weak or example secret,
- `http://` instead of HTTPS,
- the free mock payment page.

Pay-in-app is off by default (`PAYMENT_PROVIDER=none`) until a real gateway is connected. `SIGNUP_MODE` controls who can create a business account.

`docker compose up --build` in the repo root runs the production image locally at http://localhost:3000.

## Repository layout

```
deploy        Production server: Docker Compose, Caddy (HTTPS), backup/restore/update scripts
apps/api      Fastify API, jobs, WebSocket hub, migrations (plain SQL), seed & simulator CLIs, tests
apps/web      React + Vite + Tailwind PWA — src/customer (multilingual), src/owner (lazy-loaded dashboard)
packages/shared  Domain enums, types, role→permission map shared by both
docs          Design documents and research
```

## Key design decisions

- **The shop works exactly as before.** The app is additive. Coins still work. Nothing depends on our uptime or the shop's Wi-Fi.
- **Honest status.** Every machine state carries its source (sensor / customer / staff / payment). Without sensors the customer sees "from check-ins", never fake live counts. A silent sensor means "no live status", not "broken".
- **Observe before control.** Monitoring (clamp sensors) works on nearly every machine and is safe. Remote start is per model and opt-in, and a start **only counts when the sensor confirms it**. Otherwise the customer is refunded automatically and the machine is flagged.
- **No wallet.** Pay per cycle, direct to the owner's merchant account. This avoids e-money licensing and forced top-ups, the #1 complaint about chain apps.
- **Modular monolith.** One deployable and one database, with clear modules and events between them. There's a documented path to scale (rollups, Redis/NATS bus, MQTT broker).
