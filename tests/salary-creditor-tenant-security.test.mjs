import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('salary disbursement creditor lookup and balance update are tenant and soft-delete scoped', () => {
  const route = readFileSync('src/app/api/staff/route.ts', 'utf8')
  const lookup = `tx.creditor.findFirst({
            where: { id: salaryPayment.creditorId, tenantId: access.tenantId, isDeleted: false },
          })`
  const update = `where: { id: creditor.id, tenantId: access.tenantId, isDeleted: false },`
  assert.ok(route.includes(lookup), 'linked creditor must be found only within tenant and active rows')
  assert.ok(route.includes(update), 'creditor balance mutation must be tenant scoped')
  assert.doesNotMatch(route, /tx\.creditor\.findUnique\(\{ where: \{ id: salaryPayment\.creditorId \} \}\)/)
})
