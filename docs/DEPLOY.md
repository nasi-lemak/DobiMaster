# Putting DobiMaster online

This guide takes DobiMaster from the code on GitHub to a real address like `https://app.yourdobi.my` that customers and owners can use.

**Time:** about 1 hour the first time. A developer familiar with Linux servers can do it in about 20 minutes.
**You need:** a computer with a terminal (Mac Terminal, or Windows PowerShell) and a credit card.

Everything runs on **one small rented server**:
- DobiMaster itself,
- its database,
- automatic HTTPS (the padlock in the browser),
- nightly backups.

Files in [`deploy/`](../deploy):

| File | What it does |
|---|---|
| `docker-compose.yml` | Runs the four parts: database, app, HTTPS proxy (Caddy), backups |
| `Caddyfile` | Gets and renews the HTTPS certificate automatically |
| `.env.example` | All settings, explained |
| `scripts/setup-server.sh` | One-time server setup: firewall, security updates, Docker, secrets, first start |
| `scripts/update.sh` | Backs up, then updates to the latest version |
| `scripts/backup.sh` | Nightly backups of the database and photos (runs automatically) |
| `scripts/restore.sh` | Restores a backup |

## 1. What it costs

**These are rough estimates and have not been checked. Confirm current prices with each provider.**

| Item | Choice | Est. cost |
|---|---|---|
| Server | 2 GB RAM, 1–2 vCPU, Ubuntu 24.04, **Singapore** region (closest to Malaysia). Any of DigitalOcean, Vultr, Linode/Akamai, AWS Lightsail; or a Malaysian provider. | ~USD 10–15 / month |
| Provider backups | The server company's automatic weekly snapshots (tick the box when creating the server) | ~20% of the server price |
| Domain | e.g. `yourdobi.my` or `yourdobi.com` | ~RM 50–150 / year |
| Email sending (optional at first) | A transactional email service with a free tier (e.g. Brevo, Mailgun, Zoho ZeptoMail) | Free at pilot volumes |

One 2 GB server comfortably runs a pilot and should handle dozens of shops. See the cost table in [04-business.md](04-business.md) for 10 and 100 shops.

## 2. Buy a domain and create the server

1. Buy a domain from any registrar.
   - You'll use a sub-address of it, e.g. `app.yourdobi.my`.
2. Create the server at your chosen provider:
   - **Image:** Ubuntu 24.04 LTS
   - **Size:** 2 GB RAM. 1 GB works but builds slowly; the setup script adds swap memory to cope.
   - **Region:** Singapore
   - **Authentication:** SSH key if you know how; otherwise a strong root password
   - **Backups:** turn on
3. Note the server's **IP address**, e.g. `203.0.113.10`.

## 3. Point the domain at the server

In your registrar's DNS settings, add:

| Type | Name | Value |
|---|---|---|
| A | `app` | your server's IP |

That makes `app.yourdobi.my` point to the server. It usually takes a few minutes, occasionally up to a few hours.

## 4. Install DobiMaster

Open a terminal on your computer and connect to the server:

```bash
ssh root@203.0.113.10          # your server's IP
```

Then, on the server:

```bash
git clone https://github.com/nasi-lemak/dobimaster.git /opt/dobimaster
cd /opt/dobimaster
deploy/scripts/setup-server.sh
```

- **Private repository:** GitHub will ask for a username and password. Use your GitHub username and a **personal access token**, not your password. Create one at GitHub → Settings → Developer settings → Fine-grained tokens, with read-only access to this repository.

The script asks two questions:
1. Your domain (`app.yourdobi.my`).
2. Your email, for HTTPS certificate notices.

Then it does the rest:
- Installs security updates and turns on automatic updates.
- Sets up a firewall: only SSH, HTTP and HTTPS are open; the database is not reachable from the internet.
- Installs Docker.
- Generates strong random passwords, saved in `deploy/.env`.
- Checks that your domain points to this server.
- Builds and starts DobiMaster. The first build takes about 5 minutes.

When it prints **"DobiMaster is live"**, you're done.

> **Keep a copy of `deploy/.env`** (e.g. in a password manager). It holds the database password and the secret that signs logins. View it with `cat /opt/dobimaster/deploy/.env`.

## 5. Create your account

Open `https://app.yourdobi.my/owner` → **Create an account**, then follow the setup wizard.

Who can create accounts is set by `SIGNUP_MODE` in `deploy/.env`:

| Value | Meaning |
|---|---|
| `open` (default) | Any laundromat owner can sign up. Use this when you offer DobiMaster to other shops. |
| `first` | Only the first account. Use this for a private server for one business. |
| `closed` | No new sign-ups |

After changing any setting in `deploy/.env`, apply it:

```bash
cd /opt/dobimaster/deploy && docker compose up -d
```

## 6. Finish setup (recommended before the pilot)

0. **Privacy notice and terms.** They are at `/privacy` and `/terms` and are linked from every customer page and from sign-up.
   - Set the `LEGAL_*` settings in `deploy/.env`: business name, SSM registration number, address and contact email. The setup script fills in the name and email; add the rest.
   - **The texts are drafts.** Have a lawyer review them first; [LEGAL-REVIEW.md](LEGAL-REVIEW.md) is the briefing note to send them.

1. **Email.** Without it, "Forgot password" and the weekly summary only appear in the server log.
   - Sign up with an email-sending service and verify your domain there.
   - Set `SMTP_URL` and `MAIL_FROM` in `deploy/.env`.
2. **Uptime alerts.** Create a free monitor (e.g. UptimeRobot or Better Stack) for `https://app.yourdobi.my/health`, set to alert you by email or WhatsApp. If the server goes down, you'll know before your customers tell you.
3. **WhatsApp alerts (optional).** This needs a Meta WhatsApp Business account and number.
   - Set the `WHATSAPP_*` settings in `deploy/.env` and the webhook URL `https://app.yourdobi.my/api/v1/webhooks/whatsapp` in Meta's dashboard.
   - Until then, customers get alerts by web push. The WhatsApp button stays hidden.
4. **Payments stay off** (`PAYMENT_PROVIDER=none`). Customers pay with coins as usual. Change this only when a real payment gateway is connected.

## Everyday operations

All commands are run on the server, from `/opt/dobimaster/deploy`.

| Task | Command |
|---|---|
| Update to the latest version | `scripts/update.sh`. It backs up first, then pulls, rebuilds and restarts. Database changes apply automatically. |
| Is everything running? | `docker compose ps` |
| See what the app is doing | `docker compose logs --tail=100 app` |
| Back up right now | `docker compose exec backup /bin/sh /backup.sh now` |
| List backups | `ls -lh backups/` |
| Restore a backup | `scripts/restore.sh backups/db-YYYYMMDD-HHMMSS.dump backups/uploads-YYYYMMDD-HHMMSS.tar.gz` (asks you to type RESTORE) |
| Restart everything | `docker compose restart` |

**Backups:**
- The database and customer photos are backed up every night at 3 am Malaysia time and kept for 14 days. Change this with `BACKUP_HOUR` (in UTC) and `BACKUP_KEEP_DAYS`.
- These backups are on the same server, so they protect against mistakes, not against losing the server. Your provider's backups (step 2) cover that.
- For extra safety, occasionally copy a backup to your own computer:
  ```bash
  scp root@203.0.113.10:/opt/dobimaster/deploy/backups/db-*.dump .
  ```

**If the site is down:**
1. Run `docker compose ps`. Everything should show "Up".
2. Run `docker compose logs --tail=100 app caddy` and look for errors.
3. Try `docker compose restart`.
4. Check the disk: `df -h` (logs are capped, but backups accumulate if `BACKUP_KEEP_DAYS` is large).

Remember: **the laundromat keeps working without DobiMaster.** Coins and machines don't depend on it. An outage means customers lose timers and alerts until it's back, not that the shop stops.

## Safety built in

- **Refuses unsafe settings:** a production server will not start with a weak or example secret, plain `http://`, or the free test payment page. It prints exactly what to fix.
- **Network exposure:**
  - The database and app aren't reachable from the internet; only the HTTPS proxy is.
  - The firewall blocks everything else.
  - The app runs as a non-administrator user inside its container.
- **Logins:** cookies are HTTPS-only and can't be read by scripts. Login, sign-up and password-reset attempts are rate-limited per visitor, and faking your IP address doesn't get around that.
- **Logs** are capped at about 50 MB per service, so they can't fill the disk.
- **Demo accounts** are never shown on a production server.

## Demo server (optional)

To run a public demo with the sample shops:
1. Set `SHOW_DEMO_LOGINS=true`, `PAYMENT_PROVIDER=mock` and `ALLOW_MOCK_PAYMENTS=true` in `deploy/.env`.
2. Rebuild:
   ```bash
   docker compose up -d --build
   ```
3. Load the sample data:
   ```bash
   docker compose exec app node dist/seed.js
   ```

**Never do this on the server real shops use:**
- the seed **wipes all data**,
- the mock payment page lets anyone start machines for free.

## Trying it on your own computer

`docker compose up --build` in the repository root runs the production build at http://localhost:3000. It has no HTTPS and no backups, and is meant for a quick look only.
