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
