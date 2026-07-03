# Setup Guide: Custom Domain `www.tahigosoft.app`

This guide walks you through pointing **www.tahigosoft.app** at your Railway-hosted BizBook Pro instance (currently at `https://carefree-success-production-7766.up.railway.app/`).

---

## Step 1: Buy the domain

The domain `tahigosoft.app` needs to be registered first. Recommended registrars (cheapest for `.app` TLD):

| Registrar | Price (1 year) | Notes |
|-----------|---------------|-------|
| **Cloudflare Registrar** | ~$15/yr | Cheapest, no markup, free DNS + SSL |
| **Porkbun** | ~$15/yr | Free WHOIS privacy, free SSL |
| **Namecheap** | ~$17/yr | Easy UI, often has promo codes |
| **Google Domains** (now Squarespace) | ~$16/yr | Familiar interface |

**Recommendation:** Cloudflare Registrar — at-cost pricing, free DNS, free SSL, and excellent DDoS protection. Buy at https://dash.cloudflare.com/?to=/:registrar

> ⚠️ `.app` is an **HSTS preloaded** TLD — browsers will ONLY connect over HTTPS. Railway already provides HTTPS via Let's Encrypt, so this works out of the box.

---

## Step 2: Point DNS to Railway

After buying the domain, you have **two options** for DNS routing:

### Option A (Recommended): Use Railway's Custom Domain feature

Railway handles SSL automatically and gives you the cleanest setup.

1. Go to **Railway Dashboard** → your project → **Settings** → **Networking**
2. Click **Generate Domain** (if you haven't already — this gives you the `*.up.railway.app` URL)
3. Scroll down to **Custom Domains** → click **+ Add Custom Domain**
4. Enter: `www.tahigosoft.app`
5. Railway shows you a CNAME target like `xxx.railway.app` — copy it
6. In your domain registrar's DNS panel, add:
   ```
   Type:  CNAME
   Name:  www          (or www.tahigosoft.app depending on registrar)
   Value: <railway-cname-target>.railway.app
   TTL:   Auto (or 300)
   ```
7. Also add a root redirect so `tahigosoft.app` (without www) goes to `www.tahigosoft.app`:
   ```
   Type:     URL Record  (Cloudflare) or ALIAS/ANAME (other registrars)
   Name:     @           (or tahigosoft.app)
   Value:    https://www.tahigosoft.app
   ```
   If your registrar doesn't support ALIAS at the root, add this instead:
   ```
   Type:  A
   Name:  @
   Value: (Railway will show you the IP — usually 1 of 3 listed IPs)
   ```

8. Back in Railway, click **Verify** next to the custom domain. Railway provisions a Let's Encrypt SSL certificate automatically (takes 1-5 minutes).

### Option B: Use Cloudflare as a proxy in front of Railway

Use this if you want Cloudflare's CDN + DDoS protection + edge caching.

1. In Cloudflare, add `tahigosoft.app` as a site → choose **Free plan**
2. Cloudflare assigns you 2 nameservers like `xxx.ns.cloudflare.com`
3. At your registrar, set these as the domain's nameservers
4. In Cloudflare DNS panel, add:
   ```
   Type:  CNAME
   Name:  www
   Target: carefree-success-production-7766.up.railway.app
   Proxy: Proxied (orange cloud)
   ```
   And for root:
   ```
   Type:  CNAME
   Name:  @
   Target: carefree-success-production-7766.up.railway.app
   Proxy: Proxied (orange cloud)
   ```
5. SSL/TLS mode: **Full** (NOT Flexible — Flexible causes redirect loops with Railway)
6. Always Use HTTPS: ON
7. Automatic HTTPS Rewrites: ON

---

## Step 3: Update BizBook Pro to know its new domain

After DNS propagates (5-30 min for Cloudflare, up to 48 hrs for other registrars), update these env vars in Railway:

1. Railway Dashboard → your BizBook Pro service → **Variables** tab
2. Add / update these vars:
   ```
   NEXT_PUBLIC_APP_URL=https://www.tahigosoft.app
   RAZORPAY_RETURN_URL=https://www.tahigosoft.app/api/razorpay
   ```
3. The Railway service will auto-redeploy. Verify by visiting `https://www.tahigosoft.app` — you should see your BizBook Pro login page.

---

## Step 4: Update GitHub OAuth (if used later)

If you add GitHub login later, update the OAuth App:
- Homepage URL: `https://www.tahigosoft.app`
- Authorization callback URL: `https://www.tahigosoft.app/api/auth/callback`

---

## Step 5: Update Razorpay (if you have a live key)

Log into https://dashboard.razorpay.com → Settings → APIs → **Allowed Webhook Domains** → add `https://www.tahigosoft.app`

If using Razorpay Checkout (the popup), no other changes needed — the script tag in `layout.tsx` works on any domain.

---

## Verification Checklist

After completing the steps above, verify:

- [ ] `https://www.tahigosoft.app` loads the BizBook Pro login page
- [ ] `https://tahigosoft.app` (no www) redirects to `https://www.tahigosoft.app`
- [ ] Browser shows a valid SSL lock icon (no warning)
- [ ] Login + OTP works on the new domain
- [ ] Razorpay payment checkout opens correctly
- [ ] Auto-backup downloads still work (filename is `<CompanyName>_BizBook_Backup.xlsx`)
- [ ] Old URL `https://carefree-success-production-7766.up.railway.app/` still works (Railway keeps it active) but you should now market the new one

---

## Cost Summary

| Item | Cost |
|------|------|
| Domain `tahigosoft.app` (1 year) | ~$15 |
| Railway custom domain (1 domain) | **Free** (included in Hobby plan) |
| Let's Encrypt SSL | **Free** (auto-renewed by Railway) |
| Cloudflare DNS + proxy (optional) | **Free** |
| **Total** | **~$15/year** |

---

## Troubleshooting

**"This site can't be reached"** — DNS hasn't propagated yet. Wait 5-30 min, then run `nslookup www.tahigosoft.app` — it should return a Railway IP or CNAME.

**"SSL_ERROR"* in browser** — Railway is still provisioning the certificate. Wait 5 min and refresh.

**Redirect loop (Cloudflare)** — You set SSL mode to "Flexible". Change it to **Full** in Cloudflare → SSL/TLS → Overview.

**Razorpay failing on new domain** — You forgot to add the new domain in Razorpay Dashboard → Settings → Allowed Webhook Domains.
