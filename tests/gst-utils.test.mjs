import test from 'node:test'
import assert from 'node:assert/strict'

import gstUtils from '../.test-build/gst-utils.js'
import helpKnowledge from '../.test-build/help-knowledge.js'

const {
  roundTo2,
  validateGSTIN,
  getStateCode,
  isInterStateSupply,
  extractPinCode,
  calculateGST,
  splitGSTAmount,
  validateHSN,
} = gstUtils

test('roundTo2 rounds decimal half-cent values symmetrically', () => {
  assert.equal(roundTo2(1.005), 1.01)
  assert.equal(roundTo2(2.675), 2.68)
  assert.equal(roundTo2(-1.005), -1.01)
  assert.equal(roundTo2(12.344), 12.34)
})

test('roundTo2 guards non-finite input', () => {
  assert.equal(roundTo2(Number.NaN), 0)
  assert.equal(roundTo2(Number.POSITIVE_INFINITY), 0)
  assert.equal(roundTo2(Number.NEGATIVE_INFINITY), 0)
})

test('validateGSTIN accepts a valid GSTIN and rejects malformed/checksum-invalid values', () => {
  assert.deepEqual(validateGSTIN('27AAPFU0939F1ZV'), { valid: true })
  assert.equal(validateGSTIN('27AAPFU0939F1ZW').valid, false)
  assert.equal(validateGSTIN('not-a-gstin').valid, false)
})

test('GST state helpers distinguish known states and missing registrations', () => {
  assert.equal(getStateCode('18ABCDE1234F1Z5'), '18')
  assert.equal(isInterStateSupply('18ABCDE1234F1Z5', '18ABCDE1234F1Z5'), false)
  assert.equal(isInterStateSupply('18ABCDE1234F1Z5', '27AAPFU0939F1ZV'), true)
  assert.equal(isInterStateSupply('', '27AAPFU0939F1ZV'), false)
})

test('extractPinCode only returns a real six-digit PIN', () => {
  assert.equal(extractPinCode('Guwahati, Assam 781001'), 781001)
  assert.equal(extractPinCode('PIN 012345'), null)
  assert.equal(extractPinCode('No postal code'), null)
})

test('GST components reconcile exactly after rounding', () => {
  const intraState = calculateGST(5.05, 18, false)
  assert.deepEqual(intraState, { cgst: 0.46, sgst: 0.45, igst: 0, totalTax: 0.91 })
  assert.equal(intraState.cgst + intraState.sgst, intraState.totalTax)

  const interState = calculateGST(5.05, 18, true)
  assert.deepEqual(interState, { cgst: 0, sgst: 0, igst: 0.91, totalTax: 0.91 })
  assert.deepEqual(splitGSTAmount(0.91, false), { cgst: 0.46, sgst: 0.45, igst: 0 })
})

test('HSN validation enforces numeric lengths and B2B minimums', () => {
  assert.equal(validateHSN('1234', true).valid, true)
  assert.equal(validateHSN('12', true).valid, false)
  assert.equal(validateHSN('12', false).valid, true)
  assert.equal(validateHSN('12AB', false).valid, false)
})


const { HELP_FAQS, HELP_GUIDES } = helpKnowledge

test('shared help knowledge contains unique FAQ and guide titles', () => {
  const faqTitles = HELP_FAQS.map(faq => faq.q)
  const guideTitles = HELP_GUIDES.map(guide => guide.title)
  assert.equal(new Set(faqTitles).size, faqTitles.length)
  assert.equal(new Set(guideTitles).size, guideTitles.length)
  assert.ok(HELP_FAQS.length >= 21)
  assert.ok(HELP_GUIDES.length >= 11)
})

test('AI Smart Import support matches current spreadsheet and scanned-PDF limits', () => {
  assert.ok(HELP_FAQS.some(faq => /bounded batches/.test(faq.a) && /5,000 rows/.test(faq.a)))
  assert.ok(HELP_FAQS.some(faq => /all pages/.test(faq.a) && /20 pages/.test(faq.a)))
  assert.ok(HELP_FAQS.some(faq => /failed or skipped record/.test(faq.a)))
  assert.ok(HELP_GUIDES.some(guide => guide.title === 'Resolve AI Smart Import warnings and failed records'))
})

test('E-Invoice help explains seller profile auto-fill and EWB voluntary generation', () => {
  assert.ok(HELP_FAQS.some(faq => /Seller name, GSTIN and registered address are loaded automatically/.test(faq.a)))
  assert.ok(HELP_FAQS.some(faq => /voluntary generation/.test(faq.a)))
})
