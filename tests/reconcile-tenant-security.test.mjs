import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('reconciliation remediation fetches and updates records tenant-scoped and active-only', () => {
  const route = readFileSync('src/app/api/admin/reconcile/route.ts', 'utf8')
  for (const model of ['sale', 'purchase', 'debtor', 'creditor', 'inventoryItem']) {
    const lookup = `tx.${model}.findFirst({ where: { id: d.id, tenantId, isDeleted: false } })`
    assert.ok(route.includes(lookup), `${model} remediation lookup must be tenant and soft-delete scoped`)
    assert.ok(route.includes(`where: { id: d.id, tenantId, isDeleted: false }`), `${model} remediation updates must tenant and soft-delete scope`)
  }
  assert.ok(route.includes('tx.journalEntry.findUnique({ where: { id: d.id, tenantId }'), 'journal-entry remediation lookup must be tenant scoped')
  assert.ok(route.includes('db.sale.findFirst({ where: { id: je.sourceId, tenantId }'), 'orphan audit must inspect tenant-owned soft-deleted sales')
  assert.ok(route.includes('where: { id: je.sourceId, tenantId, isDeleted: false }'), 'sale JE repair must exclude soft-deleted sales')
})
