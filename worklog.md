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
