import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('../scripts/audit-invoice-numbering.js', import.meta.url), 'utf8')

test('invoice numbering audit requires isolated DB flag and rejects production mode', () => {
  assert.match(source, /INVOICE_NUMBER_AUDIT_ISOLATED_DB !== 'YES'/)
  assert.match(source, /NODE_ENV === 'production'/)
  assert.match(source, /DATABASE_URL/)
})

test('invoice numbering audit enforces PostgreSQL read-only transaction', () => {
  assert.match(source, /SET TRANSACTION READ ONLY/)
  assert.match(source, /transaction_read_only/)
  assert.match(source, /database\.read_only !== 'on'/)
})

test('invoice numbering audit only runs grouped SELECT queries and does not mutate invoices', () => {
  assert.match(source, /FROM "\$\{table\}"/)
  assert.match(source, /auditTable\(tx, 'Sale'\)/)
  assert.match(source, /auditTable\(tx, 'Purchase'\)/)
  assert.match(source, /GROUP BY "tenantId", "fyStartYear", "normalizedInvoiceNumber"/)
  assert.match(source, /COUNT\(\*\) FILTER \(WHERE COALESCE\("isDeleted", false\) = false\)/)
  assert.doesNotMatch(source, /\b(INSERT INTO|UPDATE "Sale"|UPDATE "Purchase"|DELETE FROM|\.sale\.(create|update,delete)|\.purchase\.(create,update,delete))\b/i)
})

test('audit reports active and soft-deleted duplicate groups separately', () => {
  assert.match(source, /duplicateGroupsIncludingDeleted/)
  assert.match(source, /duplicateGroupsActiveOnly/)
  assert.match(source, /groupsAffectedBySoftDeletedRecords/)
  assert.match(source, /duplicateOnlyDueToDeleted/)
})
