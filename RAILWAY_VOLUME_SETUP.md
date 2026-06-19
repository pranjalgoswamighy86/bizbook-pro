# Railway Volume Setup — Persistent Database

> **Without this, every redeploy wipes your SQLite database.**
> This is the root cause of "features disappearing" — it's not git, it's the ephemeral filesystem.

## The Problem

Railway containers have an **ephemeral filesystem**. Every redeploy:
1. Spins up a fresh container
2. `/app/db/custom.db` is **gone**
3. Server creates a new empty DB and seeds admin user
4. All your tenants, users, sales, purchases — **lost**

You can see this in the startup log:
```
SQLite database custom.db created at file:/app/db/custom.db
→ No users found, seeding admin...
```

That "created" message should only appear **once ever**, not on every deploy.

## The Fix — Railway Volume

A Railway Volume is a persistent disk that survives container restarts, redeploys, and rebuilds.

### Step 1: Create the Volume in Railway Dashboard

1. Go to your Railway project: **https://railway.app** → your BizBook Pro service
2. Click the **"+ Add"** button (or "New" → "Database" → "Volume")
3. Or: **Settings → Volumes → + Add Volume**
4. Set **Mount path** to:
   ```
   /app/data
   ```
5. Click **Add Volume**

### Step 2: Verify the Volume is Mounted

After the next redeploy, your startup log will show:
```
[VOLUME] Railway Volume detected at /app/data
[VOLUME] Found persisted DB at /app/data/custom.db (248.3KB)
[VOLUME] Symlinked /app/db/custom.db -> /app/data/custom.db
[VOLUME] Periodic persist every 60s — enabled
```

If you see:
```
[VOLUME] No Railway Volume at /app/data — DB will be EPHEMERAL (lost on redeploy)
```
…then the volume wasn't mounted. Repeat Step 1.

### Step 3: How Persistence Works (in `scripts/railway-start.js`)

```
┌──────────────────────────────────────────────────────────┐
│  Railway Container (ephemeral)                            │
│                                                           │
│  /app/db/custom.db  ─── symlink ───► /app/data/custom.db │
│  /app/db/backups/                          ▲              │
│                                            │              │
└────────────────────────────────────────────┼──────────────┘
                                             │
                          ┌──────────────────┴────────────────┐
                          │  Railway Volume (PERSISTENT)      │
                          │                                   │
                          │  /app/data/custom.db              │
                          │  /app/data/backups/*.db           │
                          │                                   │
                          └───────────────────────────────────┘
```

- **On startup:** symlink `/app/db/custom.db` → `/app/data/custom.db`
- **Every 60s:** copy live DB back to `/app/data/custom.db`
- **On SIGTERM/SIGINT:** final persist before shutdown
- **First deploy with empty volume:** seeds admin user, then persists to volume
- **Subsequent deploys:** picks up the volume's DB, never re-seeds

### Step 4: Verify Persistence

After deploying:
1. Register a user (use any email like `test@example.com`)
2. Wait 60 seconds (for the periodic persist to fire)
3. Trigger a Railway redeploy (Settings → Redeploy)
4. Log in again — your user should still be there

If the user is gone, the volume is not mounted. Check the startup log for the `[VOLUME]` lines above.

---

## Email OTP Setup — Resend API (Primary)

### Why Resend?

Railway **blocks outbound SMTP** on ports 25, 465, 587, and 2525 (anti-spam policy).
Without Resend, email OTP will **always fail** on Railway — only SMS will work.

### Step 1: Create a Resend Account

1. Go to **https://resend.com** → Sign up (free, no credit card)
2. Free tier: **3,000 emails/month, 100/day** — plenty for OTP

### Step 2: Get Your API Key

1. Resend Dashboard → **API Keys** → **+ Create API Key**
2. Name: `bizbook-pro-railway`
3. Permission: **Sending access**
4. Copy the key (`re_xxxxxxxxxxxxxxxxxxxx`)

### Step 3: Add to Railway Environment Variables

In Railway → your service → **Variables** → add:

```
RESEND_API_KEY   = re_xxxxxxxxxxxxxxxxxxxxxxxx
RESEND_FROM      = BizBook Pro <onboarding@resend.dev>
```

> The `onboarding@resend.dev` address works for testing without domain verification.
> For production, [verify your own domain](https://resend.com/domains) and use `BizBook Pro <noreply@yourdomain.com>`.

### Step 4: Verify It Works

After redeploy, register a new user. The startup log should show:

```
[EMAIL][RESEND] Sending OTP to user@example.com from BizBook Pro <onboarding@resend.dev>
[EMAIL][RESEND] ✅ OTP sent to user@example.com (id: 7a8b9c0d-...)
```

If you see `[EMAIL][SMTP]` lines after the Resend failure, the fallback is kicking in — that means Resend is misconfigured. Check your `RESEND_API_KEY`.

### Email Sender Priority

The new `src/lib/email.ts` uses this chain:

```
1. Resend API  (HTTPS 443)  ✅ works on Railway
       ↓ (on failure)
2. SMTP 465    (SSL)        ⚠️ usually blocked on Railway
       ↓
3. SMTP 587    (STARTTLS)   ⚠️ usually blocked on Railway
       ↓
4. SMTP 2525   (alt)        ⚠️ usually blocked on Railway
       ↓
   ❌ All providers failed
```

---

## All Railway Environment Variables

```
# Database
DATABASE_URL                    = file:/app/db/custom.db   (auto-set by railway-start.js)

# Email — Resend (PRIMARY, required for Railway)
RESEND_API_KEY                  = re_xxxxxxxxxxxxxxxxxxxx
RESEND_FROM                     = BizBook Pro <onboarding@resend.dev>

# Email — SMTP (FALLBACK, only works locally)
SMTP_HOST                       = smtp.gmail.com
SMTP_PORT                       = 465
SMTP_SECURE                     = true
SMTP_USER                       = pranjalgoswamighy86@gmail.com
SMTP_PASS                       = <your Gmail App Password>

# SMS — 2Factor.in (working)
TWOFACTOR_API_KEY               = <your 2Factor API key>
TWOFACTOR_TEMPLATE_NAME         = BizBook Pro
TWOFACTOR_SENDER                = BIZBOK

# Auth
MASTER_MOBILE_NUMBER            = 9101555075
ADMIN_EMAIL                     = admin@bizbook.pro
SESSION_SECRET                  = <any random 32+ char string>

# UPI Payments
MASTER_UPI_VPA                  = 9101555075@kotakbank

# App
NODE_ENV                        = production
PORT                            = 8080
NEXT_TELEMETRY_DISABLED         = 1
```

---

## Troubleshooting

### "I redeployed and all users are gone"
→ Volume not mounted. Follow **Step 1** above. Check log for `[VOLUME] Railway Volume detected`.

### "Email OTP fails but SMS works"
→ Resend not configured or RESEND_API_KEY is wrong. Check log for `[EMAIL][RESEND] ❌ API error`.

### "Volume says mounted but DB still empty"
→ Volume mount path is wrong. Must be exactly `/app/data`. Re-check in Railway dashboard.

### "I want to manually backup before redeploy"
→ The server already auto-backs up to `/app/data/backups/` on startup. List with:
```bash
railway run ls /app/data/backups/
```

### "Volume is full of old backups"
→ The code auto-cleans backups, keeping only the latest 20. No action needed.
