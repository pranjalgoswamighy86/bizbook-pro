import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync('src/app/api/purchases/route.ts', 'utf8')
const createStart = source.indexOf("if (action === 'create')")
const createEnd = source.indexOf("if (action === 'update')", createStart)
const createBlock = source.slice(createStart, createEnd)

test('purchase create wraps stock, payables, GL, payment and audit writes in one transaction', () => {
  assert.ok(createBlock.includes('db.$transaction(async (tx) =>'))
  for (const model of ['purchase', 'inventoryItem', 'creditor', 'party', 'account', 'journalEntry', 'payment', 'auditLog']) {
    assert.ok(createBlock.includes('tx.' + model + '.'), 'missing transactional tx.' + model + ' operation')
    assert.ok(!createBlock.includes('db.' + model + '.'), 'unexpected non-transactional db.' + model + ' operation')
  }
})

test('create failures propagate for transaction rollback; no partial-success warning response', () => {
  assert.ok(createBlock.includes('recordWarning = (step: string, err: unknown): never'))
  assert.ok(createBlock.includes('throw new Error(`[PURCHASE-INTEGRITY]'))
  assert.ok(!createBlock.includes('response.warnings'))
  assert.ok(createBlock.includes('return { purchase, inventoryUpdates }'))
  assert.ok(createBlock.includes("triggerAutoBackup(tenantId, 'purchase:create')"))
  assert.ok(createBlock.indexOf('db.$transaction') < createBlock.indexOf("triggerAutoBackup(tenantId, 'purchase:create')"))
})
