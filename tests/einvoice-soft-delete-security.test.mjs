import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('e-invoice API filters soft-deleted sales, purchases and tenants before use', () => {
  const route = readFileSync('src/app/api/einvoice/route.ts', 'utf8')
  assert.doesNotMatch(route, /db\\.(?:sale|purchase|tenant)\\.findUnique\\(/)
  assert.match(route, /db\\.sale\\.findFirst\\(\\{\\s*where: \\{ id: saleId, tenantId, isDeleted: false \\}/)
  assert.match(route, /db\\.purchase\\.findFirst\\(\\{\\s*where: \\{ id: purchaseId, tenantId: access\\.tenantId, isDeleted: false \\}/)
  assert.match(route, /where: \\{ id, tenantId, isDeleted: false \\}/)
  assert.match(route, /db\\.tenant\\.findFirst\\(\\{ where: \\{ id: tenantId, isDeleted: false \\} \\}/)
})
