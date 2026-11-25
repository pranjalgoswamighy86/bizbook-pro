import test from 'node:test'
import assert from 'node:assert/strict'
import { isLikelyScannedPdf, preparePdfText, MAX_PDF_IMPORT_PAGES, MAX_PDF_IMPORT_TEXT_CHARS } from '../.test-build/pdf-import-policy.js'

test('PDF import limits are bounded for page count and text context', () => {
  assert.equal(MAX_PDF_IMPORT_PAGES, 20)
  assert.equal(MAX_PDF_IMPORT_TEXT_CHARS, 30000)
})

test('detects image-only and sparse-text scanned PDFs', () => {
  assert.equal(isLikelyScannedPdf('', 3), true)
  assert.equal(isLikelyScannedPdf('Invoice number 1', 2), true)
  assert.equal(isLikelyScannedPdf('A'.repeat(100), 2), false)
})

test('keeps searchable PDF text within the configured context limit and reports truncation', () => {
  const text = 'x'.repeat(12)
  assert.deepEqual(preparePdfText(text, 5), { content: 'xxxxx', truncated: true })
  assert.deepEqual(preparePdfText('short', 5), { content: 'short', truncated: false })
})
