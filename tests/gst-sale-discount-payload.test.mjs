import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const gstUtils = readFileSync('src/lib/gst-utils.ts', 'utf8')
const einvoice = readFileSync('src/app/api/einvoice/route.ts', 'utf8')
const ewayBill = readFileSync('src/app/api/eway-bill/route.ts', 'utf8')

test('shared GST discount allocator validates percent and saved subtotal, and allocates paise to the last positive line', () => {
  assert.match(gstUtils, /export function allocateInvoiceDiscountToItems/)
  assert.match(gstUtils, /discountPercent < 0 \|\| discountPercent > 100/)
  assert.match(gstUtils, /expectedSubtotal !== undefined && Math\.abs\(subtotal - roundTo2\(expectedSubtotal\)\) > 0\.02/)
  assert.match(gstUtils, /const lastPositiveBase/)
  assert.match(gstUtils, /i === lastPositiveBase/)
  assert.match(gstUtils, /lineDiscounts\[i\] = roundTo2\(lineDiscounts\[i\] \+ allocation\)/)
})

test('e-invoice payload uses combined item and prorated invoice discounts before tax', () => {
  assert.match(einvoice, /allocateInvoiceDiscountToItems\(/)
  assert.match(einvoice, /const discount = discountAllocation\.lineDiscounts\[idx\]/)
  assert.ok(einvoice.includes('if (Math.abs(calculatedGstTotal - roundTo2(sale.gstAmount || 0)) > 0.5)'))
  assert.ok(!einvoice.includes('if (Math.abs(calculatedGstTotal - roundTo2(sale.gstAmount || 0)) > 1)'))
  assert.match(einvoice, /Math\.abs\(invoiceTotals\.rndOffAmt\) > 0\.5/)
  assert.match(einvoice, /does not reconcile/)
})

test('direct E-Way Bill taxable values include sale-level discounts and GST splits reconcile', () => {
  assert.match(ewayBill, /allocateInvoiceDiscountToItems\(/)
  assert.match(ewayBill, /discountAllocation\.lineDiscounts\[idx\]/)
  assert.match(ewayBill, /calculateItemGST\(1, item\.taxableValue, item\.gstRate, 0, isInterState\)/)
  assert.match(ewayBill, /splitGSTAmount\(roundTo2\(sale\.gstAmount \|\| 0\), isInterState\)/)
  assert.match(ewayBill, /Math\.abs\(calculatedItemTax - roundTo2\(sale\.gstAmount \|\| 0\)\) > 0\.5/)
  assert.match(ewayBill, /Calculated item GST does not reconcile/)
})
