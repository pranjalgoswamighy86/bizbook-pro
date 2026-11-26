import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('owner-role repair only mutates the authenticated tenant and pools active owner tenants', () => {
  const route = readFileSync('src/app/api/repair/route.ts', 'utf8')
  assert.ok(
    route.includes("where: { tenantId: access.tenantId, isOwner: true, role: { not: 'MAIN_ADMIN' } }"),
    'owner-role repair scan must be tenant scoped'
  )
  assert.ok(
    route.includes('where: { id: ut.userId, tenantId: access.tenantId }'),
    'user role mutation must include the authenticated tenant'
  )
  assert.ok(
    route.includes('where: { userId: access.userId, role: \'MAIN_ADMIN\', isOwner: true, tenant: { isDeleted: false } }'),
    'subscription pooling must only include active tenants owned by the authenticated user'
  )
  assert.ok(
    route.includes('tenantId: access.tenantId,'),
    'repair audit log must use the authorized tenant, not a client-supplied tenant id'
  )
})
