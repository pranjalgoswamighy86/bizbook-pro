import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chunkSpreadsheetRows,
  mergeSpreadsheetImportData,
  reconcileSourceRows,
} from '../.test-build/ai-import-chunking.js'

test('chunks every sheet row within the configured row bound and preserves source row numbers', () => {
  const batches = chunkSpreadsheetRows({
    Sales: Array.from({ length: 7 }, (_, i) => ({ invoice: `INV-${i + 1}` })),
    Purchases: [{ bill: 'PUR-1' }, { bill: 'PUR-2' }],
  }, { maxRows: 3, maxChars: 10000 })

  assert.equal(batches.length, 3)
  assert.deepEqual(batches.flatMap(batch => batch.sourceRows), [
    ...Array.from({ length: 7 }, (_, i) => ({ sheet: 'Sales', row: i + 2 })),
    { sheet: 'Purchases', row: 2 },
    { sheet: 'Purchases', row: 3 },
  ])
  assert.ok(batches.every(batch => batch.sourceRows.length <= 3))
  assert.ok(batches.every(batch => batch.summary.includes('__bizbookSource')))
})

test('starts a new batch when the character budget would be exceeded', () => {
  const batches = chunkSpreadsheetRows({ Data: [{ value: 'a'.repeat(700) }, { value: 'b'.repeat(700) }] }, { maxRows: 50, maxChars: 1000 })
  assert.equal(batches.length, 2)
})

test('reconciliation reports missing and invalid source-row outcomes', () => {
  const batches = chunkSpreadsheetRows({ Data: [{ a: 1 }, { a: 2 }] })
  const result = reconcileSourceRows(batches, [
    { sheet: 'Data', row: 2, status: 'extracted' },
    { sheet: 'Other', row: 99, status: 'ignored' },
  ])
  assert.equal(result.expected, 2)
  assert.equal(result.accounted, 1)
  assert.deepEqual(result.missing, [{ sheet: 'Data', row: 3 }])
  assert.equal(result.invalid.length, 1)
})

test('merge de-duplicates retry output only when source identities are present', () => {
  const record = { invoiceNumber: 'INV-1', _sourceRows: [{ sheet: 'Sales', row: 2 }] }
  const merged = mergeSpreadsheetImportData([
    { importData: { sales: [record, record] } },
    { importData: { sales: [{ invoiceNumber: 'same but no identity' }] } },
  ], ['sales', 'purchases'])
  assert.equal(merged.sales.length, 2)
  assert.deepEqual(merged.purchases, [])
})
