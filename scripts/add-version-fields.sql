-- ============================================================
-- BizBook Pro — Schema Patch for Optimistic Locking (H6)
-- ============================================================
-- This SQL adds a `version` column to high-contention models
-- so that the optimistic-locking helper can detect concurrent
-- modifications.
--
-- Apply with:
--   sqlite3 db/custom.db < scripts/add-version-fields.sql
--
-- Then update prisma/schema.prisma to add the field to each
-- model (see the diff at the bottom of this file), and run:
--   npx prisma generate
--
-- The version field starts at 0 and is incremented by the
-- `updateWithOptimisticLock()` helper on every update.
-- ============================================================

-- Sale
ALTER TABLE Sale ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

-- Purchase
ALTER TABLE Purchase ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

-- InventoryItem (high contention — stock adjustments)
ALTER TABLE InventoryItem ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

-- Debtor / Creditor (balances updated concurrently)
ALTER TABLE Debtor ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Creditor ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

-- BankTransaction (reconciliation)
ALTER TABLE BankTransaction ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

-- Payment / Receipt
ALTER TABLE Payment ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Receipt ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

-- Staff (salary payments)
ALTER TABLE Staff ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- schema.prisma diff (apply manually to your schema)
-- ============================================================
-- Add this line to each of the following models:
--   version Int @default(0)
--
-- Models to update:
--   Sale, Purchase, InventoryItem, Debtor, Creditor,
--   BankTransaction, Payment, Receipt, Staff
--
-- Example for Sale:
--
--   model Sale {
--     id            String   @id @default(cuid())
--     invoiceNumber String
--     ...
--     version       Int      @default(0)   -- ← ADD THIS
--     ...
--   }
--
-- After updating schema.prisma, run:
--   npx prisma generate
--
-- (Do NOT run `prisma db push` — it would try to recreate the
--  column and fail since it already exists from the SQL above.)
-- ============================================================
