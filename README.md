# 📈 IPO GMP Tracker

A **free**, personal web app + alert bot for Indian IPOs (Mainboard **and** SME).

- 🌐 **Dashboard** — shows all open / closing / upcoming / recently-listed IPOs with their **GMP** (Grey Market Premium) and % of issue price.
- 📊 **History** — records every GMP change per IPO until a few days after its closing date. Tap any IPO to see its GMP chart.
- 🔔 **Alerts** — every morning at **6:00 AM IST** you get a Telegram + WhatsApp message listing all **open IPOs with GMP > 10%**. It also sends an intraday alert the moment an IPO **crosses** 10%.
- 💸 **100% free** — runs on GitHub Actions (cron) + GitHub Pages (hosting). No servers, no bills.

---

## How it works

```
GitHub Actions (cron)                 GitHub Pages (static site)
┌─────────────────────────┐           ┌──────────────────────────┐
│ scripts/run.mjs         │  commits  │ docs/index.html          │
│  1. fetch live GMP JSON │──────────▶│  reads docs/data/*.json  │
│  2. update history      │  data to  │  renders dashboard       │
│  3. send Telegram / WA  │  repo     │                          │
└─────────────────────────┘           └──────────────────────────┘
```

- **Data source:** the same live JSON that powers investorgain.com's "Live IPO GMP" page (unofficial, indicative only). If it ever changes, only [`scripts/lib/fetchGmp.mjs`](scripts/lib/fetchGmp.mjs) needs updating.
- **Storage:** data is committed into the repo as JSON, so history is versioned by git — no database needed.

### Project layout

| Path | Purpose |
|------|---------|
| [`scripts/lib/fetchGmp.mjs`](scripts/lib/fetchGmp.mjs) | Fetch + normalize live GMP data |
| [`scripts/lib/store.mjs`](scripts/lib/store.mjs) | Update snapshot + history, prune closed IPOs, detect crossings |
| [`scripts/lib/notify.mjs`](scripts/lib/notify.mjs) | Send Telegram + WhatsApp messages |
| [`scripts/run.mjs`](scripts/run.mjs) | Orchestrator (digest / watch modes) |
| [`docs/`](docs/) | The static dashboard (served by GitHub Pages) |
| [`docs/data/`](docs/data/) | Generated JSON (`ipos.json`, `history.json`) |
| [`.github/workflows/daily.yml`](.github/workflows/daily.yml) | Cron schedule + auto-commit |

---

## 🚀 Deploy for free (one-time setup)

### 1. Put this on GitHub
Create a **new repository** (public repo = unlimited Actions minutes; recommended since the data isn't sensitive) and push this folder:

```bash
git init
git add .
git commit -m "IPO GMP tracker"
git branch -M main
git remote add origin https://github.com/<you>/ipo-gmp-tracker.git
git push -u origin main
```

### 2. Turn on GitHub Pages
Repo **Settings → Pages** → *Build and deployment* → **Source: Deploy from a branch** → Branch **main**, folder **/docs** → Save.
Your dashboard will be live at `https://<you>.github.io/ipo-gmp-tracker/`.

### 3. Set up notifications (add repo secrets)
Repo **Settings → Secrets and variables → Actions → New repository secret**.

**Telegram (recommended, unlimited & free):**
1. In Telegram, message **@BotFather** → `/newbot` → copy the **token**.
2. Send your new bot any message (e.g. "hi").
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `"chat":{"id":...}`.
4. Add secrets `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

**WhatsApp via Meta Cloud API (official — recommended, no account-ban risk):**
1. Go to https://developers.facebook.com → **Create App** → type **Business**.
2. Add the **WhatsApp** product. On **WhatsApp → API Setup** you'll see a **test sender number** and a **Phone number ID**, and you can **add your own number as a recipient** (verify it with the OTP).
3. Copy the **temporary access token** (for testing) and the **Phone number ID**.
4. Create an approved **message template** (see note below) — required so the 6am push arrives even outside the 24-hour window.
5. Add secrets: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TO` (your number, country code, no `+`), `WHATSAPP_TEMPLATE` (your template name). Optional var `WHATSAPP_TEMPLATE_LANG` (default `en_US`).

> **⚠️ Important cost/behaviour notes for Cloud API**
> - The temporary token expires in ~24h. For unattended runs, create a **System User** in Meta Business Settings and generate a **permanent token** with the `whatsapp_business_messaging` permission.
> - Freeform text only delivers within **24h** of you messaging the business number. A scheduled 6am digest therefore needs a **template** (that's why `WHATSAPP_TEMPLATE` is required).
> - **Template message:** create one under **WhatsApp Manager → Templates**, category **Utility**, language **English (US)**, with a body like `📈 IPO GMP Update\n\n{{1}}\n\n— via my IPO GMP tracker` and a sample value. A variable **cannot be at the start or end** of the body, so keep static text after `{{1}}`. The app fills `{{1}}` with the (single-line) digest.
> - **Cost:** service/freeform messages are free; **utility template** messages have a small per-message fee in some regions (fractions of ₹1). Using Meta's **test sender number** to your own verified number is free but rate-limited and dev-only. If you need *strictly zero* cost + full automation + no ban risk, Telegram remains the only option that gives all three.

**WhatsApp via Green API (unofficial — free, but carries account-ban risk):**
1. Sign up at https://green-api.com and create an instance.
2. Open the instance and **scan the QR code** with WhatsApp → *Linked Devices*.
3. Copy `idInstance` and `apiTokenInstance`.
4. Add secrets `GREENAPI_ID_INSTANCE`, `GREENAPI_TOKEN`, `GREENAPI_TO`. Use a **spare number**.

**WhatsApp via CallMeBot (unofficial — free, sign-ups often "full"):**
1. Follow https://www.callmebot.com/blog/free-api-whatsapp-messages/. Their bot is frequently at capacity, so the number may be hidden until a slot opens.
2. Add secrets `CALLMEBOT_PHONE` and `CALLMEBOT_APIKEY`.

> Any channel you skip is simply not used — Telegram alone is enough.

Optional: **Settings → Secrets and variables → Actions → Variables** → add `GMP_THRESHOLD` (default `10`).

### 4. Enable the schedule
The workflow runs automatically after the first push. To test immediately:
**Actions → "IPO GMP tracker" → Run workflow** (pick `digest`). You should get a message and see `docs/data/*.json` update.

> ⏰ GitHub cron is UTC. `30 0 * * *` = **06:00 IST**. Scheduled runs can be delayed a few minutes by GitHub during peak load — that's normal.

---

## 🖥️ Run locally

Requires **Node.js ≥ 20** (uses built-in `fetch`; **no npm install needed**).

```bash
# Update data only (no messages)
NOTIFY=0 node scripts/run.mjs

# Preview the digest message without sending
DRY_RUN=1 node scripts/run.mjs

# Preview the dashboard
npm run serve        # http://localhost:8080

# Send for real (after copying .env.example -> .env and filling it in)
set -a; source .env; set +a
npm run digest       # morning summary
npm run watch        # only newly-crossed IPOs
```

## ⚙️ Configuration

| Env / secret | Default | Meaning |
|--------------|---------|---------|
| `GMP_THRESHOLD` | `10` | Alert when GMP % is above this |
| `RUN_MODE` | `digest` | `digest` = full morning summary · `watch` = only new crossings |
| `NOTIFY` | `1` | Set `0` to update data without sending |
| `DRY_RUN` | – | Set `1` to print messages instead of sending |

## 📅 Schedule (edit in [`daily.yml`](.github/workflows/daily.yml))

| Cron (UTC) | IST | Mode |
|------------|-----|------|
| `30 0 * * *` | 06:00 | digest |
| `0 3,6,9 * * *` | 08:30 / 11:30 / 14:30 | watch |

Add more `watch` times for more responsive crossing alerts.

---

## ⚠️ Disclaimer
GMP (Grey Market Premium) comes from an **unregulated** grey market and is **indicative only**. It does not guarantee listing gains and is **not investment advice**. Data is scraped from a third-party site and may be delayed or inaccurate. Use at your own risk.
