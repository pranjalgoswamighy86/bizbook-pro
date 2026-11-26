import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const route = readFileSync('src/app/api/payment-proof/route.ts', 'utf8')

test('payment proof files are stored under the persistent data directory', () => {
  assert.ok(route.includes("process.env.DATA_DIR || join(process.cwd(), 'data')"))
  assert.ok(route.includes("join(DATA_DIR, 'payment-proofs')"))
  assert.ok(!route.includes("join(process.cwd(), 'payment-proofs')"))
})
