import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('e-invoice API filters soft-deleted sales, purchases and tenants before use', () => {
  const route = readFileSync('src/app/api/einvoice/route.ts', 'utf8')
  assert.ok(!route.includes('db.sale.findUnique('))
  assert.ok(!route.includes('db.purchase.findUnique('))
  assert.ok(!route.includes('db.tenant.findUnique('))
  assert.ok(route.includes('db.sale.findFirst({ where: { id: saleId, tenantId, isDeleted: false } })'))
  assert.ok(route.includes('db.purchase.findFirst({ where: { id: purchaseId, tenantId: access.tenantId, isDeleted: false } })'))
  assert.ok(route.includes('where: { id, tenantId, isDeleted: false }'))
  assert.ok(route.includes('db.tenant.findFirst({ where: { id: tenantId, isDeleted: false } })'))
})
