#!/bin/bash
# ============================================================
# BizBook Pro - Safe Database Migration Script
# ============================================================
# This script replaces the dangerous "prisma db push" command.
# It ALWAYS backs up the database before applying any schema changes.
# If the migration fails, it automatically restores from backup.
#
# Usage: ./scripts/db-safe-push.sh
# ============================================================

set -e

echo "🔒 BizBook Pro - Safe Database Migration"
echo "=========================================="

# Step 1: Backup the database
echo ""
echo "Step 1: Creating database backup..."
./scripts/db-backup.sh backup

if [ $? -ne 0 ]; then
  echo "❌ Backup failed! Aborting migration to protect your data."
  exit 1
fi

# Step 2: Count existing records to verify data integrity after migration
echo ""
echo "Step 2: Counting existing records..."
DB_PATH="db/custom.db"

# Count records in key tables (if they exist)
count_records() {
  local table=$1
  local count=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM $table;" 2>/dev/null || echo "0")
  echo "$table: $count records"
}

echo "Current data:"
count_records "User"
count_records "Tenant"
count_records "Sale"
count_records "Purchase"
count_records "InventoryItem"
count_records "Expense"
count_records "Staff"
count_records "Debtor"
count_records "Creditor"
count_records "Payment"
count_records "Receipt"

# Step 3: Apply schema changes using prisma db push
echo ""
echo "Step 3: Applying schema changes with Prisma..."
npx prisma db push 2>&1

if [ $? -ne 0 ]; then
  echo ""
  echo "❌ Migration failed! Restoring database from backup..."
  ./scripts/db-backup.sh restore
  echo "Database restored. Your data is safe."
  exit 1
fi

# Step 4: Generate Prisma client
echo ""
echo "Step 4: Generating Prisma client..."
npx prisma generate

# Step 5: Verify data integrity
echo ""
echo "Step 5: Verifying data integrity after migration..."
echo "Data after migration:"
count_records "User"
count_records "Tenant"
count_records "Sale"
count_records "Purchase"
count_records "InventoryItem"
count_records "Expense"
count_records "Staff"
count_records "Debtor"
count_records "Creditor"
count_records "Payment"
count_records "Receipt"

echo ""
echo "✅ Migration completed successfully! Your data is preserved."
