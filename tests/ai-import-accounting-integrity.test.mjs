import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const route = readFileSync('src/app/api/ai-import/route.ts', 'utf8')

test('AI-imported sales are marked confirmed and included in confirmed-only reporting', () => {
  assert.match(route, /invoiceStatus:\s*'CONFIRMED'/)
  assert.doesNotMatch(route, /invoiceStatus:\s*'INVOICE'/)
})

test('AI-import sales and purchases synchronize party subledger balances in the same transaction as GL and stock', () => {
  assert.match(route, /syncImportedSaleBalances\(tx,\s*tid,/)
  assert.match(route, /syncImportedPurchaseBalances\(tx,\s*tid,/)
  assert.match(route, /async function syncImportedSaleBalances\([\s\S]*?tx\.debtor\.findFirst[\s\S]*?tx\.party\.findFirst/)
  assert.match(route, /async function syncImportedPurchaseBalances\([\s\S]*?tx\.creditor\.findFirst[\s\S]*?tx\.party\.findFirst/)
  assert.match(route, /where:\s*\{\s*tenantId,\s*name:\s*partyName,\s*isDeleted:\s*false\s*\}/)
})

test('AI-import subledger balances clamp overpayment and exclude cash counterparties', () => {
  assert.match(route, /if \(partyName\.trim\(\)\.toLowerCase\(\) === 'cash'\) return/)
  assert.match(route, /Math\.max\(0, totalAmount - Math\.min\(Math\.max\(amountReceived, 0\), totalAmount\)\)/)
  assert.match(route, /const paid = Math\.min\(Math\.max\(amountPaid, 0\), totalAmount\)/)
})
