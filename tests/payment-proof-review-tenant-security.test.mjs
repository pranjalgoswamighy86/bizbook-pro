import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const upload = readFileSync('src/app/api/payment-proof/route.ts', 'utf8')
const review = readFileSync('src/app/api/payment-proof/review/route.ts', 'utf8')

test('payment proof download and review use the shared system-admin allowlist', () => {
  assert.ok(upload.includes('isSystemAdminEmail(user.email)'))
  assert.ok(review.includes('isSystemAdminEmail(user.email)'))
  assert.ok(!upload.includes('const ADMIN_EMAILS'))
  assert.ok(!review.includes('ADMIN_OVERRIDE_EMAILS'))
})

test('failed proof upload removes the file written before the database update', () => {
  assert.ok(upload.includes('let createdFilePath: string | null = null'))
  assert.ok(upload.includes('if (createdFilePath) await unlink(createdFilePath).catch'))
  assert.ok(upload.includes('createdFilePath = null'))
})

test('proof review lists only active tenants and approval is tenant-scoped', () => {
  assert.ok(review.includes("where: { status: 'PROOF_SUBMITTED', tenant: { isDeleted: false } }"))
  assert.ok(review.includes('tenantId: entry.tenantId'))
  assert.ok(review.includes('tenant: { isDeleted: false }'))
})

test('proof rejection is limited to submitted proofs and uses a conditional transition', () => {
  assert.ok(review.includes("if (entry.status !== 'PROOF_SUBMITTED')"))
  assert.ok(review.includes('const rejected = await db.subscriptionQueue.updateMany'))
  assert.ok(review.includes('if (rejected.count !== 1)'))
})
