import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('payment proof approval is conditional, idempotent, and financially atomic', () => {
  const route = readFileSync('src/app/api/payment-proof/review/route.ts', 'utf8')
  const approvalStart = route.indexOf("// ---------- APPROVE PROOF")
  const rejectionStart = route.indexOf("// ---------- REJECT PROOF")
  assert.ok(approvalStart >= 0 && rejectionStart > approvalStart, 'approval section must exist')
  const approval = route.slice(approvalStart, rejectionStart)

  assert.ok(approval.includes("entry.status !== 'PROOF_SUBMITTED'"), 'only submitted proofs may be approved')
  assert.ok(approval.includes("tx.subscriptionQueue.updateMany({"), 'approval must atomically claim the queue entry')
  assert.ok(approval.includes("status: 'PROOF_SUBMITTED'"), 'claim must require the still-pending submitted state')
  assert.ok(approval.includes("if (claimed.count !== 1)"), 'concurrent/repeated approval must fail closed')
  assert.ok(approval.includes("await tx.subscription.upsert({"), 'subscription activation must use the same transaction')
  assert.ok(approval.includes("await tx.recharge.create({"), 'recharge ledger entry must use the same transaction')
  assert.ok(!approval.includes("db.recharge.create("), 'recharge must not be written outside the transaction')
  assert.ok(!approval.includes("db.subscription.upsert("), 'subscription must not be written outside the transaction')
})
