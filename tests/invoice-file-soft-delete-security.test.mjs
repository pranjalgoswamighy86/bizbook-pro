import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('invoice downloads require an active tenant-owned sale or purchase reference', () => {
  const route = readFileSync('src/app/api/invoice-file/route.ts', 'utf8')

  assert.ok(route.includes("rawDb.sale.findFirst({"))
  assert.ok(route.includes("rawDb.purchase.findFirst({"))
  assert.equal((route.match(/isDeleted: false/g) || []).length, 2)
  assert.ok(route.includes('tenantId: authorizedTenantId, invoiceFile: requestedFile, isDeleted: false'))
  assert.ok(route.includes('Invoice file not found.'))
  assert.ok(route.includes("Cache-Control': 'private, no-store, max-age=0'"))
})
