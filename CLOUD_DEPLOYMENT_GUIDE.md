# Deploying BizBook Pro to Free Cloud Platforms
# ============================================================

## Quick Comparison

| Platform | Free Tier | RAM | Disk | Sleeps? | Best For |
|----------|-----------|-----|------|---------|----------|
| **Render.com** | 750 hrs/month | 512MB | $1/mo for 1GB disk | Yes (15 min idle) | Easiest setup |
| **Railway.app** | $5 credit/mo | 512MB | Volume included | No | Always-on |
| **Fly.io** | 3 VMs × 256MB | 256MB | 3GB free volume | Yes (auto-stop) | Global CDN |
| **Koyeb** | 1 instance | 512MB | Persistent | No | Simple |

---

## Option 1: Render.com (Recommended — Easiest)

### Step 1: Push to GitHub
```bash
cd /home/z/my-project
git init
git add -A
git commit -m "BizBook Pro - Production Ready"
# Create repo on GitHub.com, then:
git remote add origin https://github.com/YOUR_USERNAME/bizbook-pro.git
git branch -M main
git push -u origin main
```

### Step 2: Deploy on Render
1. Go to https://dashboard.render.com → **New +** → **Blueprint**
2. Select your GitHub repository
3. Render reads `render.yaml` automatically
4. Click **Apply**

### Step 3: Set Secret Environment Variables
In Render dashboard → Environment:
- `SESSION_SECRET` = (generate: `openssl rand -hex 32`)
- `SMTP_USER` = `pranjalgoswamighy86@gmail.com`
- `SMTP_PASS` = `nvyz jufl wbbc ffys`
- `SMTP_FROM` = `BizBook Pro <pranjalgoswamighy86@gmail.com>`
- `TWOFACTOR_API_KEY` = `cf178fc7-67cf-11f1-8f15-0200cd936042`
- `RAZORPAY_KEY_ID` = (your Razorpay key, or leave empty)
- `RAZORPAY_KEY_SECRET` = (your Razorpay secret, or leave empty)

### Step 4: Add Persistent Disk (IMPORTANT for SQLite)
- Render dashboard → your service → Disks → **Add Disk**
- Name: `bizbook-db`
- Mount Path: `/opt/render/project/src/db`
- Size: 1 GB ($1/month)

### Step 5: Access Your App
```
https://bizbook-pro.onrender.com
```
- First deploy takes ~5 minutes
- The app sleeps after 15 min of no traffic (free tier)
- Wakes automatically when someone visits (takes ~30 seconds)

---

## Option 2: Railway.app (Always On — $5/mo credit)

### Step 1: Push to GitHub (same as Render)

### Step 2: Deploy on Railway
1. Go to https://railway.app → **New Project** → **Deploy from GitHub repo**
2. Select your repository
3. Railway reads `railway.json` automatically

### Step 3: Add Volume
- Railway dashboard → your service → Settings → **Volumes**
- Add Volume: Mount Path = `/app/db`, Size = 1 GB

### Step 4: Set Environment Variables
Same as Render (see above)

### Step 5: Access Your App
Railway auto-generates a URL like:
```
https://bizbook-pro-production.up.railway.app
```

---

## Option 3: Fly.io (Global CDN — 3 Free VMs)

### Step 1: Install flyctl
```bash
curl -L https://fly.io/install.sh | sh
flyctl auth login
```

### Step 2: Launch
```bash
cd /home/z/my-project
flyctl launch --no-deploy
# Answer: Yes to copy Dockerfile, No to create Postgres
```

### Step 3: Create Volume + Set Secrets
```bash
flyctl volumes create bizbook_data --size 1

flyctl secrets set SESSION_SECRET="$(openssl rand -hex 32)"
flyctl secrets set SMTP_USER="pranjalgoswamighy86@gmail.com"
flyctl secrets set SMTP_PASS="nvyz jufl wbbc ffys"
flyctl secrets set SMTP_FROM="BizBook Pro <pranjalgoswamighy86@gmail.com>"
flyctl secrets set TWOFACTOR_API_KEY="cf178fc7-67cf-11f1-8f15-0200cd936042"
flyctl secrets set TWOFACTOR_SENDER_ID="BIZBOK"
flyctl secrets set TWOFACTOR_TEMPLATE_NAME="BizBook Pro"
```

### Step 4: Deploy
```bash
flyctl deploy
```

### Step 5: Access Your App
```
https://bizbook-pro.fly.dev
```

---

## Which Should You Choose?

### For testing / personal use → **Render.com**
- Free, easy, auto-deploys from GitHub
- Sleeps when idle (fine for testing)
- 1GB disk costs $1/month (optional — without it, DB resets on redeploy)

### For production (always on) → **Railway.app**
- $5/month free credit ≈ 500 hours
- No sleep — always responds instantly
- Persistent disk included
- Best for real businesses using the app daily

### For global scale → **Fly.io**
- 3 free VMs in different regions
- Auto-scales globally
- Persistent volume included
- Best if you have users in multiple countries

---

## Important Notes

### SQLite + Cloud = Persistent Disk Required!
BizBook Pro uses SQLite (a file-based database). Without a persistent disk:
- Every deploy/restart WIPES the database
- All user accounts, sales, purchases are LOST
- The app resets to the login screen

**Always add a persistent disk** mounted at the `db/` directory.

### Custom Domain
All three platforms support custom domains:
- Render: Dashboard → Settings → Custom Domain
- Railway: Dashboard → Settings → Networking → Custom Domain
- Fly.io: `flyctl certs add yourdomain.com`

### Environment Variables
Set ALL of these in the cloud dashboard:
```
SESSION_SECRET=<random 64-char hex string>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=pranjalgoswamighy86@gmail.com
SMTP_PASS=nvyz jufl wbbc ffys
SMTP_FROM=BizBook Pro <pranjalgoswamighy86@gmail.com>
TWOFACTOR_API_KEY=cf178fc7-67cf-11f1-8f15-0200cd936042
TWOFACTOR_SENDER_ID=BIZBOK
TWOFACTOR_TEMPLATE_NAME=BizBook Pro
RAZORPAY_KEY_ID=<your key or empty>
RAZORPAY_KEY_SECRET=<your secret or empty>
```

### Migrating From Alibaba Cloud FC
1. Export your current data: Settings → Data Management → Export JSON
2. Deploy to the new platform (follow steps above)
3. Import your data: Settings → Data Management → Import JSON
4. Update your domain DNS to point to the new platform
