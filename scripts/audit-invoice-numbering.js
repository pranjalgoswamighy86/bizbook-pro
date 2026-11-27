#!/usr/bin/env node
/**
 * Read-only GST invoice numbering audit for an isolated restored database.
 * Run: INVOICE_NUMBER_AUDIT_ISOLATED_DB=YES NODE_ENV=development DATABASE_URL=<isolated-db> node scripts/audit-invoice-numbering.js
 * Only SELECTs are issued inside a PostgreSQL READ ONLY transaction.
 */
'use strict'

const { PrismaClient } = require('@prisma/client')

if (process.env.INVOICE_NUMBER_AUDIT_ISOLATED_DB !== 'YES') {
  console.error('Refusing to run: set INVOICE_NUMBER_AUDIT_ISOLATED_DB=YES only for a verified isolated database copy.')
  process.exit(2)
}
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run with NODE_ENV=production.')
  process.exit(2)
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL must point to an isolated restored database.')
  process.exit(2)
}

const prisma = new PrismaClient({ log: [] })

async function auditTable(tx, table) {
  // Table identifiers are hard-coded in this allowlist, never sourced from user input.
  const rows = await tx.$queryRawUnsafe(`
    SELECT
      "tenantId" AS "tenantId",
      CASE WHEN EXTRACT(MONTH FROM "date") >= 4
        THEN EXTRACT(YEAR FROM "date")::int
        ELSE (EXTRACT(YEAR FROM "date")::int - 1)
      END AS "fyStartYear",
      LOWER(BTRIM(COALESCE("invoiceNumber", ''))) AS "normalizedInvoiceNumber",
      COUNT(*)::int AS "recordCount",
      COUNT(*) FILTER (WHERE COALESCE("isDeleted", false) = false)::int AS "activeCount",
      COUNT(*) FILTER (WHERE COALESCE("isDeleted", false) = true)::int AS "deletedCount",
      ARRAY_AGG("id" ORDER BY "createdAt", "id") AS "recordIds",
      ARRAY_AGG(COALESCE("isDeleted", false) ORDER BY "createdAt", "id") AS "deletedFlags"
    FROM "${table}"
    GROUP BY "tenantId", "fyStartYear", "normalizedInvoiceNumber"
    HAVING LOWER(BTRIM(COALESCE("invoiceNumber", ''))) = ''
       OR COUNT(*) > 1
    ORDER BY "tenantId", "fyStartYear", "normalizedInvoiceNumber"
  `)
  return rows.map(row => ({
    ...row,
    financialYear: `${row.fyStartYear}-${String(row.fyStartYear + 1).slice(-2)}`,
    recordIds: row.recordIds,
    deletedFlags: row.deletedFlags,
    duplicateIncludingDeleted: row.recordCount > 1,
    duplicateActive: row.activeCount > 1,
    duplicateOnlyDueToDeleted: row.recordCount > 1 && row.activeCount <= 1,
    blankInvoiceNumber: row.normalizedInvoiceNumber === '',
  }))
}

async function main() {
  const report = await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
    const [database] = await tx.$queryRawUnsafe(
      "SELECT current_database() AS database, current_user AS database_user, current_setting('transaction_read_only') AS read_only"
    )
    if (database.read_only !== 'on') throw new Error('Transaction is not read-only; aborting.')

    const [sales, purchases] = await Promise.all([
      auditTable(tx, 'Sale'),
      auditTable(tx, 'Purchase'),
    ])
    const summarize = records => ({
      flaggedGroups: records.length,
      blankInvoiceNumberGroups: records.filter(item => item.blankInvoiceNumber).length,
      duplicateGroupsIncludingDeleted: records.filter(item => item.duplicateIncludingDeleted).length,
      duplicateGroupsActiveOnly: records.filter(item => item.duplicateActive).length,
      groupsAffectedBySoftDeletedRecords: records.filter(item => item.duplicateOnlyDueToDeleted).length,
    })
    return {
      database: { name: database.database, user: database.database_user, readOnly: database.read_only },
      sales: { summary: summarize(sales), flaggedGroups: sales },
      purchases: { summary: summarize(purchases), flaggedGroups: purchases },
      interpretation: [
        'This is a diagnostic inventory only; it does not alter records or assign invoice numbers.',
        'Duplicate grouping is tenant + Indian financial year (April–March) + case-insensitive trimmed invoice number.',
        'Soft-deleted records are included so historical serial reuse is visible; active-only counts are also reported.',
        'Rule 46 invoice numbering requirements and tenant-specific numbering conventions require human review before remediation.',
      ],
    }
  }, { timeout: 120000 })
  console.log(JSON.stringify(report, null, 2))
}

main()
  .catch(error => {
    console.error('Invoice numbering audit failed:', error.message)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
