/**
 * add-services-item-type.js
 *
 * Documents the addition of the SERVICES item type to the inventory system.
 *
 * Item Type Reference
 * -------------------
 * RAW_MATERIAL     — Physical input material used in production (BOM ingredient).
 *                    Inventory stock is required and tracked. Stock is deducted
 *                    when used in manufacturing or sold directly.
 *
 * RETAIL_PRODUCT   — Physical product purchased for resale without manufacturing.
 *                    Inventory stock must be available before a sale can proceed.
 *                    Stock is deducted on each sale.
 *
 * FINISHED_PRODUCT — Manufactured product with a Bill of Materials (BOM/recipe).
 *                    Inventory stock must be available before a sale can proceed.
 *                    Selling a FINISHED_PRODUCT deducts both the finished item
 *                    stock and the underlying raw material ingredients.
 *
 * SERVICES         — Intangible service (consulting, labour, delivery, etc.).
 *                    No physical inventory stock is tracked or required.
 *                    Sales of SERVICES items bypass all stock availability checks
 *                    and do not trigger any inventory deductions.
 *
 * No database schema migration is required — the `itemType` column on the
 * `InventoryItem` model is already a plain string field that accepts any value.
 *
 * Application-level changes shipped with this update
 * ---------------------------------------------------
 * 1. src/components/modules/inventory.tsx
 *    - Badge display updated to show four distinct labels and colours:
 *        RAW_MATERIAL     → "Raw Material"     (grey)
 *        RETAIL_PRODUCT   → "Retail Product"   (purple)
 *        FINISHED_PRODUCT → "Finished Product" (blue)
 *        SERVICES         → "Service"          (teal)
 *    - Add/Edit Item dialog dropdown now offers:
 *        Raw Material | Retail Product | Service
 *      (FINISHED_PRODUCT items are created automatically via the BOM/Products tab)
 *    - BOM ingredient selector (rawMaterials filter) continues to exclude
 *      SERVICES items — services cannot be used as manufacturing inputs.
 *
 * 2. src/app/api/sales/route.ts
 *    - CREATE sale: SERVICES items skip all stock-availability checks and
 *      inventory deductions. The sale price is updated if provided.
 *    - UPDATE sale: SERVICES items are excluded from both the old-inventory
 *      reversal pass and the new-inventory deduction pass.
 *    - DELETE sale: SERVICES items are excluded from the inventory reversal
 *      pass so stock counts are not incorrectly incremented.
 *
 * Usage
 * -----
 * This script is documentation only — no execution is needed.
 * To verify existing data, run the query below against your PostgreSQL database:
 *
 *   SELECT "itemType", COUNT(*) AS count
 *   FROM "InventoryItem"
 *   WHERE "isDeleted" = false
 *   GROUP BY "itemType"
 *   ORDER BY count DESC;
 *
 * To bulk-update existing items to SERVICES (if needed):
 *
 *   UPDATE "InventoryItem"
 *   SET "itemType" = 'SERVICES'
 *   WHERE id IN ('<uuid1>', '<uuid2>')
 *     AND "isDeleted" = false;
 */

console.log('SERVICES item type documentation — no migration required.')
console.log('itemType values in use: RAW_MATERIAL, RETAIL_PRODUCT, FINISHED_PRODUCT, SERVICES')
