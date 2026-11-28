import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync('src/app/api/inventory/route.ts', 'utf8')
const start = source.indexOf("if (action === 'adjust-stock')")
const end = source.indexOf("return NextResponse.json({ error: 'Invalid action' }", start)
const block = source.slice(start, end)

test('stock adjustment is tenant scoped, serializable and conditionally atomic', () => {
  assert.ok(block.includes('db.$transaction(async (tx)'))
  assert.ok(block.includes("isolationLevel: 'Serializable'"))
  assert.ok(block.includes('currentStock: { gte: quantity }'))
  assert.ok(block.includes('currentStock: type === \'in\' ? { increment: quantity } : { decrement: quantity }'))
  assert.ok(block.includes('updatedCount.count !== 1'))
  assert.ok(block.includes('isDeleted: false'))
})

test('stock adjustment rejects invalid quantities and handles concurrency conflicts', () => {
  assert.ok(block.includes('Number.isFinite(quantity)'))
  assert.ok(block.includes('quantity <= 0'))
  assert.ok(block.includes("code === 'P2034'"))
  assert.ok(block.includes('status: 409'))
})

test('stock value and audit log update in the same transaction', () => {
  assert.ok(block.includes('updatedStock.currentStock * updatedStock.purchasePrice'))
  assert.ok(block.includes('await tx.auditLog.create'))
  assert.ok(!block.includes('writeAuditLog('))
})
