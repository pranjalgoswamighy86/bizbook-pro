import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('party get-or-create and balance update require authenticated tenant access', () => {
  const route = readFileSync('src/app/api/parties/route.ts', 'utf8')
  const getOrCreateStart = route.indexOf("if (action === 'get-or-create')")
  const balanceStart = route.indexOf("if (action === 'update-balance')")
  const invalidActionStart = route.indexOf("return NextResponse.json({ error: 'Invalid action'", balanceStart)
  assert.ok(getOrCreateStart >= 0 && balanceStart > getOrCreateStart)
  const getOrCreate = route.slice(getOrCreateStart, balanceStart)
  const balance = route.slice(balanceStart, invalidActionStart)
  assert.ok(getOrCreate.includes('requireAuthAndTenant(req, tenantId)'), 'get-or-create must authenticate and validate tenant membership')
  assert.ok(getOrCreate.includes('tenantId: scopedTenantId'), 'get-or-create must use authenticated tenant for lookup and creation')
  assert.ok(getOrCreate.includes('where: { id: existing.id, tenantId: scopedTenantId, isDeleted: false }'), 'get-or-create updates must tenant and active scope')
  assert.ok(balance.includes('requireAuthAndTenant(req, tenantId)'), 'balance update must authenticate and validate tenant membership')
  assert.ok(balance.includes('where: { name: partyName, tenantId: access.tenantId, isDeleted: false }'), 'balance lookup must use authenticated tenant')
  assert.ok(balance.includes('where: { id: party.id, tenantId: access.tenantId, isDeleted: false }'), 'party balance write must be tenant scoped')
  assert.ok(balance.includes('tenantId: access.tenantId, isDeleted: false'), 'linked debtor and creditor lookups must tenant and active scope')
})
