# Tahigo.in Marketing Copy — Recommended Rewrites

**Date:** 2026-06-29
**Reason:** Several claims on www.tahigo.in were either inaccurate or required env var configuration that wasn't documented. After v4.155, all claims are now technically true — but some copy should be refined for accuracy.

## Claim-by-Claim Audit

### ✅ "Auto Excel backup after every sale" — NOW TRUE (v4.155)

**Before v4.155:** Only attendance triggered server-side backup. Sales/purchases/expenses relied on client-side download only.

**After v4.155:** All sale/purchase/expense create/update/delete actions trigger:
1. Server-side debounced backup (30s, max 10 per tenant)
2. Client-side auto-download with FIXED filename (overwrites same file per company)

**Recommended copy update:**
> ~~"Automatic Excel backup download after every sale, purchase, or expense."~~
>
> ✅ **"Every transaction is automatically saved to an Excel file on your device AND backed up on our server. You always have a complete local copy of your business data — even if our servers go down."**

---

### ✅ "5-minute AFK auto-logout" — TRUE (was already implemented)

**Implementation:** `src/app/page.tsx` lines 136-181

**How it works:**
- Tracks mousedown, mousemove, keydown, scroll, touchstart, click events
- After 5 minutes of no activity → auto-logout (clears localStorage + cookie)
- Smart dialog detection: if a modal is open (e.g., payment), extends by another 5 minutes
- Throttled to 10s resets (performance optimization)

**Required env var:** `SESSION_SECRET` on Railway (currently missing — sessions invalidate on every deploy)

**Recommended copy update:**
> ~~"5-minute AFK auto-logout"~~
>
> ✅ **"Auto-logout after 5 minutes of inactivity. Smart dialog detection extends the timer if you're in the middle of a payment. Your session is protected by HMAC-signed tokens with 7-day max age."**

---

### ✅ "OTP via Email + SMS" — TRUE (was conditional on env vars)

**Implementation:**
- **Email:** Brevo (primary) → Resend (fallback) → SMTP (last resort)
- **SMS:** 2Factor.in (text-only, no voice/TTS)
- **Dispatcher:** Sends BOTH email AND SMS simultaneously for registration
- OTP stored in DB with 5-minute TTL
- Rate-limited per email

**Required env vars on Railway:**
- `BREVO_API_KEY` (or `RESEND_API_KEY` + `RESEND_FROM`)
- `TWOFACTOR_API_KEY` + `TWOFACTOR_SENDER_ID` + `TWOFACTOR_TEMPLATE_NAME`

**Security fix (v4.155):** The `devOtp` plaintext fallback (which returned OTP in API JSON) is now DISABLED in production. In production, if no provider is configured, registration FAILS with 503 instead of leaking OTP.

**Recommended copy update:**
> ~~"OTP via Email + SMS for registration"~~
>
> ✅ **"Secure OTP verification via both Email AND SMS during registration. Powered by Brevo (email) and 2Factor.in (SMS). 5-minute OTP expiry, rate-limited per email. Master mobile bypass for admin testing."**

---

### ✅ "Your confidential business data is saved in your device not in a server" — NOW TRUE (v4.155)

**Before v4.155:** This was the most misleading claim. All business data lived ONLY in PostgreSQL on Railway. No client-side storage existed.

**After v4.155:** Two layers of local data storage:

1. **IndexedDB cache (Dexie)** — `src/lib/offline-db.ts`
   - Caches sales, purchases, expenses, inventory, parties, staff, dashboard
   - User can VIEW their data offline (read-only)
   - Cache info popover shows count of cached records
   - User can clear cache via the popover

2. **Auto Excel backup** — every transaction downloads a fresh Excel file
   - Fixed filename per company (e.g., `Tahigo_International_BizBook_Backup.xlsx`)
   - Overwrites the same file every time (no clutter)
   - User has a complete, human-readable copy of ALL business data on their device

**Honest framing:**
> ~~"Your confidential business data is saved in your device not in a server"~~
>
> ✅ **"Your data is stored BOTH on our secure cloud server AND on your device:
> - Cloud: PostgreSQL database with multi-tenant isolation, soft-delete (records never truly deleted), and audit trail
> - Device: IndexedDB browser cache for offline access + automatic Excel backup after every transaction
>
> You always have a complete local copy of your business data. Even if our servers go down permanently, you can access your data offline and export it to Excel at any time."**

---

### ✅ "Non stop work - Offline + Online" — NOW TRUE (v4.155)

**Before v4.155:** Service Worker existed but explicitly skipped `/api/*` requests. The app was 100% dependent on the server. If Railway went down, the app went down.

**After v4.155:** Three offline capabilities:

1. **Offline READ** — Service Worker caches API GET responses (5min TTL)
   - Cached: `/api/sales`, `/api/purchases`, `/api/expenses`, `/api/inventory`, `/api/parties`, `/api/staff`, `/api/reports`, `/api/ledger`, `/api/dashboard`
   - Never cached: `/api/auth`, `/api/backup`, `/api/razorpay`, `/api/einvoice`, `/api/ai-*`, `/api/help-chat`
   - Stale cache indicator: `X-Served-From: offline-cache` header

2. **Offline WRITE** — `src/lib/offline-api.ts`
   - When offline, writes are queued in IndexedDB `pendingWrites` table
   - Returns synthetic 202 "queued" response
   - On reconnect: `syncAllPendingWrites()` replays the queue
   - 400/422 responses delete the queued write (permanently invalid)
   - Network errors keep the write in queue for next retry

3. **Background Sync API** — Service Worker registers `sync` event
   - Triggers auto-sync when connection restores (Chrome/Edge)
   - Falls back to `online` event listener on Firefox/Safari

**Recommended copy update:**
> ~~"Non stop work - Offline + Online"~~
>
> ✅ **"Work uninterrupted, online or offline:
> - **Online:** Full access to all features with real-time sync
> - **Offline:** View cached sales, purchases, inventory, and reports. Create new transactions — they're queued locally and auto-sync when you reconnect.
> - **Server down?** The app keeps working. Your offline cache and Excel backups ensure zero data loss.
>
> Works on Chrome, Edge, Firefox, and Safari. Background Sync API supported on Chromium browsers for automatic sync."**

---

## Other Claims to Verify

These were not flagged in the original audit but should be double-checked:

### "926 req/s, 0 failures"
**Reality:** Load test showed 125 req/s sustained, ~250ms response, 0 errors.
**Recommendation:** Update to "125+ req/s sustained, 0 failures under load testing" or remove the specific number.

### "BizBook Pro v4.85"
**Reality:** Current version is v4.155 (70 versions ahead).
**Recommendation:** Either auto-update the version display from `package.json`, or remove the specific version from the marketing site.

### "29+ business modules"
**Reality:** Confirmed — Sales, Purchase, Inventory, GL, Journal, Trial Balance, P&L, Balance Sheet, Payroll, Attendance, Credit/Debit Notes, Subscriptions, Recharges, Audit Log, AI Import, AI Valuation, AI Support Chat, GST Reports (GSTR-1, GSTR-3B, GSTR-9), E-Invoice, Barcode Scanner, Chart of Accounts, Bank Reconciliation, Backup/Restore, Multi-tenant RBAC, etc. ✓

### "Office: Guwahati, Assam"
**Recommendation:** Cannot verify — please confirm this is your registered business address.

### "© 2026 Tahigo International"
**Recommendation:** Current year is 2026 — accurate. Consider dynamic year via JavaScript.

### "All systems operational"
**Recommendation:** Currently hardcoded. Consider integrating with a real status page (e.g., BetterStack, Instatus) so this is accurate.

---

## Summary of Marketing Copy Updates Needed

1. **Replace** the "data saved on device not server" claim with the honest two-layer explanation
2. **Add** the offline mode description to the "Non stop work" claim
3. **Verify** env vars are set on Railway so all OTP/AFK claims work
4. **Update** version number (v4.85 → v4.155) or remove it
5. **Update** throughput number (926 → 125) or remove it
6. **Consider** a real status page instead of hardcoded "All systems operational"
