import test from 'node:test'
import assert from 'node:assert/strict'
import { isValidEwbNumber, isValidIrpSuccessResult } from '../.test-build/gsp-response-policy.js'

test('accepts a complete IRP success response', () => {
  assert.equal(isValidIrpSuccessResult({ Irn: 'a'.repeat(64), AckNo: 123456789, AckDt: '2026-11-25 10:30:00' }), true)
})

test('rejects IRP success responses missing or containing malformed acknowledgement data', () => {
  assert.equal(isValidIrpSuccessResult({ Irn: 'a'.repeat(64), AckNo: '', AckDt: '2026-11-25' }), false)
  assert.equal(isValidIrpSuccessResult({ Irn: 'short', AckNo: 123, AckDt: '2026-11-25' }), false)
  assert.equal(isValidIrpSuccessResult(null), false)
})

test('accepts only 12-digit EWB numbers', () => {
  assert.equal(isValidEwbNumber('123456789012'), true)
  assert.equal(isValidEwbNumber(' 123456789012 '), true)
  assert.equal(isValidEwbNumber('12345'), false)
  assert.equal(isValidEwbNumber('12345678901A'), false)
})
