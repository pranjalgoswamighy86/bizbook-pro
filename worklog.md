# BizBook Pro — Shared Worklog

---
Task ID: v4.66
Agent: Main (Super Z)
Task: Implement Sales Register item type dropdown (Retail Product / Finished Product / Services) with Services skipping inventory stock logic.

Work Log:
- Read existing `src/components/modules/sale-register.tsx` (1179 lines) to understand current item row layout
- Read existing `src/app/api/sales/route.ts` (593 lines) to understand inventory deduction logic in create/update/delete
- Confirmed `SaleItem` interface already has `saleItemType?: 'RETAIL_PRODUCT' | 'FINISHED_PRODUCT' | 'SERVICE'` field (added in prior session) but UI and backend logic were not wired up

Stage Summary:
- Plan: Update `emptyItem()` default → add Item Type `<Select>` dropdown in Row 1 of each item (5-col grid) → show context-aware badge for Service/Finished Product → patch all 3 backend actions (create / update / delete) to skip inventory operations when `saleItemType === 'SERVICE'` → bump to v4.66

Implementation Complete:
- `src/components/modules/sale-register.tsx` (107 lines added):
  - `emptyItem()` now defaults `saleItemType: 'RETAIL_PRODUCT'`
  - Added `SALE_ITEM_TYPE_LABELS` constant
  - Added `updateItemType(index, newType)` function — handles switching to SERVICE (clears BOM badge) / FINISHED_PRODUCT / RETAIL_PRODUCT
  - Updated `updateItem` so name-change auto-detection of BOM products respects SERVICE (won't override)
  - Row 1 grid expanded from 4 cols to 5 cols — added "Item Type" dropdown as first column
  - SERVICE items show "✨ No stock deducted" violet badge; BOM items show amber "Includes raw materials" badge
  - Added HRS / JOB units for service billing
  - `handleEdit` now backfills `saleItemType` for legacy sales (RETAIL_PRODUCT default, FINISHED_PRODUCT if itemType matches)
  - View Sale dialog shows "Service" (violet) or "BOM" (amber) badge next to item name; legacy items still show old BOM badge
  - Print invoice HTML adds [SERVICE] tag next to service item names
- `src/app/api/sales/route.ts` (9 lines added):
  - `create` action: `if (item.saleItemType === 'SERVICE') continue` at top of inventory loop
  - `update` action: skip SERVICE in BOTH reverse-old and apply-new loops (avoids phantom stock additions on edit)
  - `delete` action: skip SERVICE in reverse-inventory loop (avoids phantom stock additions on delete)
- `src/components/modules/settings.tsx`: version bumped v4.57.0 → v4.66.0

Verification:
- `npx tsc --noEmit --skipLibCheck` confirmed 0 new errors introduced. Two pre-existing errors in `sale-register.tsx` (lines 326 and 1017) are in untouched code (`handleEdit` setForm missing payment fields, `partPaymentAmount` typo) — verified via `git stash` test that these existed before my changes (at lines 282 and 943).
- `npx eslint` on both changed files: clean (no errors, no warnings).

Behavior:
- New Sale Invoice > Items > Item Type dropdown defaults to "Retail Product"
- Selecting "Service" (e.g., BizBook Pro subscription, consulting fee, installation charge): no inventory lookup, no stock check, no auto-create inventory item, no BOM deduction, no stock reversal on edit/delete
- Selecting "Finished Product": triggers BOM raw-material deduction (existing behavior, but now user can explicitly choose)
- Selecting "Retail Product" (default): standard single-item inventory deduction (existing behavior)
- The `saleItemType` field is persisted in the items JSON blob — no Prisma schema migration required.

---
Task ID: v4.66.1 (Hotfix)
Agent: Main (Super Z)
Task: User reported "Item Type dropdown still not available" — screenshot showed runtime error page "CardDescription is not defined"

Work Log:
- Read screenshot at /home/z/my-project/upload/Screenshot 2026-06-22 172422.png via VLM
- VLM analysis confirmed: error page showing "Something went wrong! CardDescription is not defined"
- Read deploy logs (logs.1782129342895.log) — confirmed build succeeded, app started, but Settings module crashed at runtime
- Root cause: `src/components/modules/settings.tsx` line 5 was missing `CardDescription` import. Line 583 (Staff Activity tab, added in v4.65 worklog) uses `<CardDescription>` but the import was forgotten. This is a real `ReferenceError` at runtime (not just a TS warning) because Next.js 16 ships without runtime type info.
- Because the Settings module crashes, the entire `/` route bundle crashes (Next.js error boundary), which is why the user couldn't see the New Sale Invoice item type dropdown either — the whole app was in an error state.

Fixes Applied:
1. `src/components/modules/settings.tsx` line 5:
   - BEFORE: `import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'`
   - AFTER:  `import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'`
2. `src/components/modules/sale-register.tsx` (cleanup while here):
   - Removed dead `newForm.partPaymentAmount = 0` reference (left over from v4.61 → v4.62 refactor). Replaced with proper reset of all `ppCash/ppCard/ppUpi/ppOther/ppCredit/ppOtherRemarks` fields when switching to PART_PAYMENT mode.
   - Fixed `handleEdit` `setForm` call — was missing all payment-related fields (paymentMode, ppCash, ppCard, ppUpi, ppOther, ppCredit, ppOtherRemarks, paymentRemarks), causing TypeScript error and potentially undefined values when editing existing sales.

Verification:
- `npx tsc --noEmit --skipLibCheck` on sale-register.tsx / sales/route.ts / settings.tsx → 0 errors (down from 4 pre-existing errors)
- `npx eslint` on all 3 files → clean

Stage Summary:
- This was a critical runtime blocker, not a missing feature. The Item Type dropdown was already implemented correctly in v4.66 — it just couldn't be seen because the entire app was erroring out due to the missing `CardDescription` import in the Staff Activity tab.
- After redeploy, the user should see the Item Type dropdown as the FIRST column in each item row of the New Sale Invoice form, with three options: Retail Product (default), Finished Product, Service.
- Selecting "Service" will show a violet "✨ No stock deducted" badge and the backend will skip all inventory operations for that line item on create/update/delete.

---
Task ID: v4.66.2 (Push Hotfix)
Agent: Main (Super Z)
Task: User reported the same error "CardDescription is not defined" — verified fix wasn't deployed yet

Work Log:
- Read new screenshot (Screenshot 2026-06-22 173247.png) — confirmed SAME error page
- Read deploy logs (logs.1782129797120.log) — confirmed build timestamp 2026-06-22T08:36:46Z is identical to previous deploy (image digest sha256:ccac218fc... unchanged)
- Root cause: my v4.66.1 hotfix was committed locally but NEVER pushed to GitHub. Railway therefore never rebuilt with the fix.
- Verified `git status` → "working tree clean" but "ahead of origin/main by 2 commits"
- Ran `git push origin main` → successfully pushed commits 5cd0429..18ba0a8

Stage Summary:
- Pushed 2 commits containing:
  - v4.66 (sale-register item type dropdown + backend SERVICE skip)
  - v4.66.1 (CardDescription import fix + partPaymentAmount cleanup + handleEdit setForm fix)
- Railway should auto-detect the GitHub push and start a new build within ~30 seconds
- Build typically takes ~3 minutes (Dockerfile: npm install → prisma generate → next build → postbuild.js)
- After deploy completes, the user should hard-refresh (Ctrl+Shift+R) to clear browser cache and the app should work normally with the Item Type dropdown visible in New Sale Invoice.

---
Task ID: v4.67
Agent: Main (Super Z)
Task: Special request — delete user account `amritsonowal165@gmail.com` so the tenant can re-register

Work Log:
- Reviewed Prisma schema: User.email is @unique (blocks re-registration even if soft-deleted)
- Reviewed existing /api/db-admin — no destructive operations supported (by design)
- Reviewed SUPER_ADMIN authentication in src/lib/rbac/enforce-v2.ts
  - SUPER_ADMIN_EMAILS: ['admin@bizbook.pro', pranjalgoswamighy86@gmail.com]
- Reviewed soft-delete extension in src/lib/db-soft-delete.ts
  - findFirst auto-filters isDeleted=false (would miss soft-deleted users)
  - delete is hard-delete (only WHERE clause is filtered, not converted to soft-delete)
  - rawDb export available for queries that need to bypass soft-delete filter
- Created new endpoint: src/app/api/admin/delete-account/route.ts

Endpoint Design:
- POST /api/admin/delete-account
- Authentication: requireAuth + SUPER_ADMIN email check (hardcoded list)
- Two-step process: preview → confirm
- Preview returns: targetUser info, ownedTenants with record counts, staffTenants
- Confirm performs:
  1. Audit log written FIRST (survives deletion)
  2. Remove staff-tenant links (where user is NOT owner)
  3. Delete other users in owned tenants (staff of the tenant being deleted)
  4. Delete the tenant (cascades to sales, purchases, inventory, subscriptions, etc.)
  5. Delete the target user (if not already cascade-deleted)
- All operations inside rawDb.$transaction (atomic — all or nothing)
- Safety: cannot delete SUPER_ADMIN accounts (self-protection)

Verification:
- TypeScript: 0 errors in delete-account/route.ts
- ESLint: clean

Stage Summary:
- Pushed commit ff4f26b to GitHub → Railway will auto-rebuild (~3 min)
- After deploy, Pranjal can delete amritsonowal165@gmail.com by:
  1. Log in as admin@bizbook.pro or pranjalgoswamighy86@gmail.com
  2. Open browser DevTools console
  3. Run preview: fetch('/api/admin/delete-account', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'preview', email:'amritsonowal165@gmail.com' }) }).then(r=>r.json()).then(console.log)
  4. Review the preview output (tenant names, record counts)
  5. Run confirm: fetch('/api/admin/delete-account', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'confirm', email:'amritsonowal165@gmail.com' }) }).then(r=>r.json()).then(console.log)
  6. The user can then re-register normally

---
Task ID: v4.109
Agent: Main (Super Z)
Task: User reported "option not working" for the Complete Database Backup feature — uploaded deploy/runtime logs showing the app deployed successfully but TENANT-PROTECT warning that kdhomesghy@gmail.com tenant was missing.

Work Log:
- Read both uploaded log files:
  - logs.1782423966686.log (deploy log): Build succeeded, healthcheck passed. v4.108 (the previous backup feature) was deployed correctly.
  - logs.1782423963597.log (runtime log): Container started, DB synced, 2 users preserved, but [TENANT-PROTECT] [ERROR] "1 protected tenant(s) MISSING: kdhomesghy@gmail.com" — non-blocking warning.
- Reviewed existing /api/backup/download/route.ts — works but requires a logged-in session cookie.
- Reviewed /api/auth/route.ts login flow — found the bug: line 441 accessed defaultTenant.id without null check. If user.tenant was soft-deleted (filter applies to include), defaultTenant is null and the code throws TypeError, caught by the outer catch block which returns generic "Internal server error" 500. The user then can't log in to reach the Settings page where the backup option lives.
- Reviewed src/lib/db-soft-delete.ts — confirmed that the soft-delete extension DOES apply to includes (via $allOperations), so include: { tenant: true } returns null for soft-deleted tenants.
- Reviewed Prisma schema: User.tenant has onDelete: Cascade, so hard-deleted tenant would also cascade-delete the user. But soft-deleted tenant leaves the user orphaned.
- Reviewed /api/backup/route.ts (existing) — only supports per-tenant JSON export, not full-DB backup.

Root Cause:
- The user's primary tenant was soft-deleted (or never re-created after PostgreSQL migration). When they try to log in, the include returns null tenant → login crashes → user can't reach Settings → can't use the backup option.
- Even if login worked, the existing /api/backup/download endpoint gives no useful error info — just a generic "Backup Failed" toast with no details.

Fixes Applied:
1. src/app/api/auth/route.ts (login flow):
   - Changed `const defaultTenant = user.tenant` to `let defaultTenant = user.tenant`
   - Added null check: if defaultTenant is null, fall back to the first company in the user's UserTenant list whose tenant loaded
   - Auto-migrate the user's tenantId to the fallback tenant (non-blocking, ignore errors)
   - If no companies exist at all (fully orphaned user), return a clear 403 error with emergencyBackupUrl pointer instead of crashing with 500
   - Also defensively handle c.tenant?.name in workspace selection and companies list (in case a tenant is null there too)

2. src/app/api/backup/emergency/route.ts (NEW):
   - POST endpoint: accepts { email, password } in body — no session required
   - Authenticates via rawDb.user.findFirst (bypasses soft-delete filter, so soft-deleted users can still get their data)
   - Verifies password with verifyPassword() — same constant-time comparison as login
   - Exports ALL 31 tables (Tenant, User, UserTenant, Party, Product, ProductIngredient, Sale, Purchase, Expense, InventoryItem, BankTransaction, BankStatementUpload, Staff, SalaryPayment, Payment, Receipt, Debtor, Creditor, Account, JournalEntry, JournalEntryLine, Batch, PriceList, PriceListItem, Subscription, SubscriptionQueue, Recharge, UsageLog, AuditLog, HelpSupportTicket, PasswordReset)
   - Per-table try/catch — if one table fails (schema mismatch, etc.), the rest still export and the error is recorded in tableErrors array
   - Writes audit log entry (best-effort, only if user has a valid tenantId pointing to an existing tenant)
   - Returns JSON as attachment with Content-Disposition header
   - Also supports GET with ?email=...&password=... for easy browser/curl testing (less secure but useful for non-technical users)
   - maxDuration = 300 seconds (5 minutes) for large databases
   - dynamic = 'force-dynamic' to ensure it always runs on the server

3. public/emergency-backup.html (NEW):
   - Standalone HTML page (no React/Next.js load required) at /emergency-backup.html
   - Simple form: email + password + Download button
   - Red gradient header with "Emergency Database Backup" title
   - Yellow warning box explaining when to use this
   - Spinner + progress text during download ("Verifying credentials and packaging the database... 5-30 seconds")
   - Success message shows elapsed time + file size in MB
   - Error messages show actual server error text (not generic "Backup failed")
   - Expandable help sections: What happens, How long, How to restore, curl alternative, Security
   - Mobile-responsive design
   - Accessible even if the main React app fails to load

4. src/components/modules/settings.tsx:
   - Added new "Emergency Backup" card (amber/yellow theme) in Data Management tab with "Open Emergency Backup Page" button that opens /emergency-backup.html in a new tab
   - Improved existing "Download Complete Backup" button error handling: now reads the error response body and shows the actual server error message instead of just "Backup Failed"
   - Added AlertTriangle icon to lucide-react import
   - Bumped displayed version v4.66.0 → v4.109.0

Verification:
- `npx tsc --noEmit` (full project): 0 errors in any of the 3 changed/created files. Pre-existing errors in unrelated files (excel-backup.ts, totp.ts, zai-client.ts, etc.) are unchanged.
- `npx eslint` on all 3 changed/created files: clean (no errors, no warnings).

Deployment:
- Committed as v4.109 (commit 39681bc)
- Pushed to GitHub: ab26e86..39681bc main → main
- Railway will auto-detect the push and start a new build (~3 minutes typical)
- After deploy, the user has THREE ways to download a complete database backup:
  1. Settings > Data Management > Download Complete Backup (requires login — now with better error messages)
  2. Settings > Data Management > Emergency Backup > Open Emergency Backup Page (requires login to reach Settings, but the page itself doesn't need a session)
  3. Direct URL: https://their-app.up.railway.app/emergency-backup.html (NO login required — just email+password)
- The login crash is also fixed: if the user's tenant was deleted, they'll either be auto-migrated to a fallback tenant (if they have one) or see a clear error message pointing them to /emergency-backup.html

Stage Summary:
- This was a recovery/safety-net fix, not just a feature add. The user's "option not working" was actually a symptom of a deeper issue: their primary tenant was missing, which crashed the login flow, which blocked them from reaching the Settings page where the backup option lives.
- The new /emergency-backup.html page is the safety net — it works even when everything else is broken, as long as the user knows their email and password.
- After this deploy, the user should hard-refresh (Ctrl+Shift+R) and try the Download Complete Backup option again. If it still fails, they can go directly to https://their-app.up.railway.app/emergency-backup.html and download their data with just email+password.

---
Task ID: v4.110
Agent: Main (Super Z)
Task: User requested three fixes:
  1. "Help & Support Management + Help & Support > should be in one panel"
  2. "barcode scanner and barcode printer option is gone"
  3. "the barcode is not the name of any product its SKU instead"
  User also confirmed v4.109 emergency backup worked by uploading the actual downloaded JSON file (bizbook_pro_EMERGENCY_backup_2026-06-25T21-58-52-151Z.json).

Work Log:
- Verified v4.109 deploy succeeded by reading uploaded deploy/runtime logs (logs.1782425145445.log + logs.1782425148371.log). Build clean, container started, DB synced.
- Reviewed sidebar.tsx: Found that SUPER_ADMIN saw a separate "Help & Support Management" nav item (id: 'help-support-management') that loaded the bare management page, AND on mobile the regular "Help & Support" button was hidden for SUPER_ADMIN (per v4.67 comment). So SUPER_ADMIN on mobile only saw the management page — no FAQ/Guides/Chat access.
- Reviewed help-modal.tsx: Already had 4 tabs (FAQ, Guides, AI Chat, Manage) with Manage tab visible only to SUPER_ADMIN. So the unified panel already existed — it was just being hidden from SUPER_ADMIN.
- Reviewed help-support-management.tsx: Standalone module that loads support tickets. Already embedded inside HelpModal's Manage tab via lazy import.
- Reviewed barcode-scanner.tsx: Full implementation exists (camera + BarcodeDetector API), but only imported (not actually used) in sale-register.tsx and purchase-register.tsx.
- Reviewed barcode-label.tsx: BarcodeLabel component + printBarcodeLabel() function exist, but never imported anywhere.
- Reviewed inventory.tsx: Has both 'sku' and 'barcode' fields on InventoryItem, with separate form inputs. No barcode scanner or printer UI.
- Reviewed lib/barcode.ts: Has generateBarcodeSvg() (Code128 encoder), generateRandomBarcode(), and generateBarcodeFromSku() — all ready to use.
- Reviewed sale-register.tsx + purchase-register.tsx: Both import BarcodeScanner but never render it. ItemSuggest is used for item search.

Fix 1 — Merge Help panels:
- src/components/app/sidebar.tsx: Removed the 'help-support-management' nav item (line 83) from navItems array. Updated comment explaining the v4.110 change.
- src/components/app/sidebar.tsx: Removed the !isSuperAdmin condition on the mobile drawer Help button (line 318) — now shown to ALL users.
- src/components/app/help-modal.tsx: Updated version string v4.64 → v4.110. Updated Manage tab description to clarify it's SUPER_ADMIN-only.
- Left the lazy import + switch case in page.tsx for 'help-support-management' view in place (defensive — if user's stored view state is 'help-support-management' from a previous session, it still loads correctly. They just don't see the nav item to click it.)

Fix 2+3 — Restore Barcode scanner/printer using SKU:
- src/components/app/barcode-label.tsx: Added new printBulkBarcodeLabels() function — prints multiple labels on one A4 sheet (3 cols × 4 rows = 12 per page). Each label: product name + price + SKU-as-barcode.
- src/components/modules/inventory.tsx:
  • Added imports: BarcodeScanner, printBarcodeLabel, printBulkBarcodeLabels, Printer + ScanLine icons.
  • Added 'Scan' button next to the Barcode input field in the Add/Edit form. On scan, fills BOTH barcode and SKU fields with the scanned value (they stay in sync since barcode = SKU per user instruction).
  • Updated Barcode field onChange to also update SKU, and SKU field onChange to also update Barcode — so editing one updates the other.
  • Updated field labels: "Barcode (Unique ID)" → kept, "SKU" → "SKU (used as barcode)" with helpful placeholder.
  • Added blue Printer icon button to each inventory item row (after Status, before the +/- stock adjustment buttons). Only shown if item has a SKU. Click → printBarcodeLabel() opens new window with single label using item.sku as the barcode value.
  • Added "Print All Barcodes" bulk button at the top of the raw materials tab, next to "Add Item". Click → filters items with non-empty SKU, maps them to label data, calls printBulkBarcodeLabels(). Shows helpful error toast if no items have SKUs.
- src/components/modules/sale-register.tsx:
  • Added 'Scan' button next to ItemSuggest in each sale item row (Row 1, col-span-2). On scan, fetches /api/inventory with search=scannedCode, finds the item whose sku or barcode matches (case-insensitive), and auto-fills the row with name, category, hsn, unit, sale price, mrp, gst rate. Shows success toast with item name + SKU. Shows helpful error toast if no match.
- src/components/modules/purchase-register.tsx:
  • Same as sale-register, but uses purchase price (not sale price) for the auto-fill.
- src/components/modules/settings.tsx: Version bumped v4.109.0 → v4.110.0.

Verification:
- npx tsc --noEmit (full project): 0 errors in any of the 7 changed files. Pre-existing errors in unrelated files (excel-backup.ts, totp.ts, zai-client.ts, enforce-v2.ts, etc.) unchanged.
- npx eslint on all 7 files: 0 errors, 1 pre-existing warning in sidebar.tsx (unused eslint-disable directive at line 113 — was there before my changes).

Deployment:
- Committed as v4.110 (commit b6972a2)
- Pushed to GitHub: 39681bc..b6972a2 main → main
- Railway auto-build triggered (~3 min typical)

Stage Summary:
- Issue 1 (Help panels merged): DONE. SUPER_ADMIN now sees the same unified Help & Support button as everyone else. The HelpModal's Manage tab gives them ticket management — no separate panel needed.
- Issue 2 (Barcode scanner/printer restored): DONE. Three access points:
  1. Inventory form: Scan button fills Barcode + SKU fields
  2. Inventory list: Printer icon per row prints single label
  3. Inventory list: Print All Barcodes button prints all SKUs on one A4 sheet
  4. Sale Register: Scan button per item row looks up by SKU and auto-fills
  5. Purchase Register: Same as Sale
- Issue 3 (Barcode = SKU, not product name): DONE. The printBarcodeLabel and printBulkBarcodeLabels functions receive the SKU as the barcode value. The Inventory form keeps Barcode and SKU in sync — editing one updates the other. Scan button fills both with the same value.
- The barcode scanner uses the browser's BarcodeDetector API (Chrome/Edge 83+) with manual-entry fallback. The barcode printer uses SVG + window.print() so it works in all browsers. Labels are formatted for 80mm × 40mm thermal printers (single) or A4 sheets (bulk, 12 per page).

---
Task ID: v4.111
Agent: Main (Super Z)
Task: User reported two issues via screenshots:
  1. Screenshot 1 (034809.png): Settings > Data Management shows three red "Backup Failed - Server returned 404" toasts. The "Download Complete Backup" button returns 404.
  2. Screenshot 2 (034907.png): New Sale Invoice form — user drew a RED BOX at the top of the "Items" section indicating they want a barcode scanner button there (for bulk/rapid scanning). The per-row Scan button added in v4.110 IS visible next to Item Name, but they want a top-level bulk scanner too.

Work Log:
- Read uploaded deploy log (logs.1782425904927.log): Confirmed v4.110 deploy succeeded. Build clean, healthcheck passed. BUT — noticed the route list only shows /api/backup and /api/backup/emergency. The /api/backup/download route is MISSING.
- Verified file exists locally: src/app/api/backup/download/route.ts is on disk (created in v4.108 session).
- Ran 'git ls-files src/app/api/backup/': confirmed the file is NOT tracked in git. Only emergency/route.ts and route.ts are tracked.
- Ran 'git check-ignore -v src/app/api/backup/download/route.ts': Found that .gitignore line 75 has 'download/' which matches ANY directory named download/ anywhere in the project, including src/app/api/backup/download/.
- Root cause: .gitignore had TWO 'download/' entries (lines 68 and 75) intended to ignore a top-level local downloads folder, but the pattern was too broad — it accidentally blocked the API route directory.

Fix 1 — Backup 404:
- .gitignore: Changed both 'download/' entries to '/download/' so they only match a top-level 'download/' folder at project root. This is the intended use case (local downloads folder), not API route folders.
- src/app/api/backup/download/route.ts: Now properly tracked in git. Will deploy to Railway on next build. This is the v4.108 endpoint that exports all DB tables as a downloadable JSON attachment (requires logged-in session).

Fix 2 — Bulk "Scan Barcode to Add Item" button:
- src/components/app/barcode-scanner.tsx: Added new 'continuous' prop (default false). When true:
    • Scanner stays open after each scan and immediately resumes detecting
    • 2-second cooldown prevents same barcode firing onScan multiple times
    • Visible scan counter ('X scanned' badge in dialog header)
    • 'Done' button label after first scan (instead of 'Close')
    • detectLoopRef stores the detect loop function so handleDetected can resume it (previously scoped to startScanning, couldn't be resumed)
    • Manual entry input is cleared after each entry in continuous mode

- src/components/modules/sale-register.tsx: Added bulk "Scan Barcode to Add Item" button at top of Items section (where red box is in screenshot). On each scan:
    1. Calls /api/inventory with search=scannedCode
    2. Finds item whose sku or barcode matches (case-insensitive)
    3. Creates new SaleItem via emptyItem() + fills name/category/hsn/unit/salePrice/mrp
    4. Adds GST tax entry if item has gstRate > 0
    5. Auto-detects BOM (FINISHED_PRODUCT) items
    6. Runs calcItemTotals() so amount/tax/total are correct
    7. Appends to items array via setItems(prev => [...prev, finalItem])
    8. Shows success toast: "Added: <name>" / "SKU: ... · ₹<price>"
    Scanner stays open for next scan. User clicks Done when finished.

- src/components/modules/purchase-register.tsx: Same bulk scan button at top of Items section. Uses purchasePrice (not salePrice) since this is a purchase invoice.

- src/components/modules/settings.tsx: v4.110.0 → v4.111.0
- src/components/app/help-modal.tsx: v4.110 → v4.111

Verification:
- npx tsc --noEmit (full project): 0 errors in any of the 7 changed files
- npx eslint on all 7 files: 0 errors, 0 warnings

Deployment:
- Committed as v4.111 (commit 137ebb6)
- Pushed to GitHub: b6972a2..137ebb6 main → main
- Railway auto-build triggered (~3 min typical)

Stage Summary:
- Issue 1 (Backup 404): FIXED. The root cause was a .gitignore pattern that was too broad — 'download/' matched any directory named download/, including the API route folder. Changed to '/download/' (root-only). The /api/backup/download/route.ts file is now tracked in git and will deploy.
- Issue 2 (Bulk barcode scanner): FIXED. A new "Scan Barcode to Add Item" button appears at the top of the Items section in both Sale Register and Purchase Register. Click it → camera opens → scan item → row auto-added with all details → scan next item → row auto-added → click Done. The scanner stays open for rapid-fire scanning (with 2-second cooldown to prevent duplicate scans of the same item).
- The per-row "Scan" button (added in v4.110) remains for editing existing rows in place. Users now have two ways to scan: bulk-add (top of Items section) or per-row edit (next to Item Name).
- Note: Barcode scanning requires Chrome/Edge 83+ (BarcodeDetector API) and HTTPS. Falls back to manual entry on unsupported browsers. The bulk scanner also supports manual entry — type a SKU and press Enter to add an item, then type another SKU and press Enter again.
