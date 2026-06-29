# BizBook Pro — Production Environment Variables Checklist

**Last updated:** v4.155 (2026-06-29)
**Deployment:** Railway (https://carefree-success-production-7766.up.railway.app)

## CRITICAL — Set These on Railway Immediately

These env vars are required for the marketing claims on tahigo.in to be TRUE.

### 1. Session Security (AFK auto-logout claim)

```
SESSION_SECRET=<32+ char random string>
NODE_ENV=production
```

**Why:** Without `SESSION_SECRET`, all user sessions invalidate on every server restart (happens on every Railway deploy). The 5-minute AFK auto-logout (implemented in `src/app/page.tsx`) is bypassed if the server can't verify tokens consistently.

**Generate a secret:**
```bash
openssl rand -hex 32
# or
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

### 2. Email OTP (so registration/password reset works in production)

The OTP bypass that returns OTP in plaintext JSON is now DISABLED in production (v4.155). You MUST configure at least one email provider.

**Option A — Brevo (recommended, free up to 300 emails/day):**
1. Sign up at https://www.brevo.com/
2. Get API key from https://app.brevo.com/settings/keys/api
3. Set on Railway:
```
BREVO_API_KEY=xkeysib-...
```

**Option B — Resend (only delivers to account owner on free tier):**
1. Sign up at https://resend.com
2. Get API key
3. Set on Railway:
```
RESEND_API_KEY=re_...
RESEND_FROM=BizBook Pro <onboarding@resend.dev>
```

**Option C — SMTP (works for Gmail, Outlook, etc.):**
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=BizBook Pro <your-email@gmail.com>
```

> ⚠️ Railway blocks outbound SMTP on ports 465/587/2525. Use Brevo or Resend on Railway.

**Emergency override** (NOT recommended — only for staging):
```
OTP_BYPASS_ALLOWED=true
```

---

### 3. SMS OTP (for mobile verification)

**2Factor.in** (Indian SMS provider):
1. Sign up at https://2factor.in
2. Get API key
3. Register a DLT-approved template (required by TRAI)
4. Set on Railway:
```
TWOFACTOR_API_KEY=...
TWOFACTOR_SENDER_ID=BIZBOK
TWOFACTOR_TEMPLATE_NAME=BizBook Pro OTP
```

---

### 4. Razorpay (already configured ✅)

```
RAZORPAY_KEY_ID=rzp_live_T7MZNVB6eOvAUR
RAZORPAY_KEY_SECRET=VLfHu53F8sM2azuM2fBmoYrA
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_T7MZNVB6eOvAUR
```

---

### 5. Database (already configured ✅)

```
DATABASE_URL=postgresql://...@...railway.app:5432/railway
```

---

## OPTIONAL — Enable Advanced Features

### E-Invoice IRP (Direct IRN generation, no manual copy-paste)

Sign up with any GSP (GST Suvidha Provider):
- ClearTax: https://cleartax.in
- Adaequare: https://www.adaequare.com
- Masters India: https://mastersindia.co

Set on Railway:
```
IRP_GSP_CODE=clear
IRP_GSP_USERNAME=...
IRP_GSP_PASSWORD=...
IRP_GSP_CLIENT_ID=...
IRP_GSP_CLIENT_SECRET=...
IRP_ENV=sandbox  # or 'production' when going live
```

Without these, e-invoice works in MANUAL mode (user copies INV-01 JSON, submits to IRP portal, pastes back IRN).

### AI Provider Keys (for fallback when ZAI is rate-limited)

```
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=sk-ant-...
```

Already have ZAI configured via `.z-ai-config` — these are optional fallbacks.

### Master Bypass (for admin testing)

```
MASTER_MOBILE_NUMBER=9101555075
ADMIN_EMAIL=admin@bizbook.pro
INFRASTRUCTURE_OWNER_EMAIL=your-email@example.com
```

---

## WHAT THE MARKETING SITE CLAIMS vs REALITY (v4.155)

| Claim on tahigo.in | Status | What's needed |
|---|---|---|
| "5-minute AFK auto-logout" | ✅ **TRUE** (code at `src/app/page.tsx` lines 136-181) | Set `SESSION_SECRET` on Railway |
| "OTP via Email + SMS" | ✅ **TRUE** (Brevo + 2Factor) | Set `BREVO_API_KEY` + `TWOFACTOR_API_KEY` |
| "Auto Excel backup after every sale" | ✅ **TRUE** (v4.155) | Server-side + client-side download work out of the box |
| "Your data is saved on your device" | ✅ **TRUE** (v4.155) | IndexedDB cache + Excel auto-download work out of the box |
| "Non stop work — Offline + Online" | ✅ **TRUE** (v4.155) | Service Worker + IndexedDB + offline write queue work out of the box |

---

## VERIFICATION CHECKLIST

After setting all env vars on Railway:

- [ ] App redeploys automatically
- [ ] Login works (no OTP required for login — only registration + reset)
- [ ] Register a new user — OTP arrives via email within 30 seconds
- [ ] Wait 5 minutes without activity — automatically logged out
- [ ] Create a sale — Excel file auto-downloads to your device
- [ ] Disconnect internet — app shows "You're offline" banner
- [ ] While offline, view sales/purchases — cached data loads
- [ ] While offline, create a sale — shows "queued" toast
- [ ] Reconnect — pending writes auto-sync to server
- [ ] Refresh — sale appears in the list, synced

If any of these fail, check Railway logs for the specific error.
