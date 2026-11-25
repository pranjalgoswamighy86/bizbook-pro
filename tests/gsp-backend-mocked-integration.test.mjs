import test from 'node:test'
import assert from 'node:assert/strict'
import { submitToIrp } from '../.test-build/irp-integration.js'
import { generateEwbDirect } from '../.test-build/ewb-integration.js'

const originalFetch = globalThis.fetch
const validIrn = 'a'.repeat(64)
const config = (tenantId) => ({
  tenantId,
  gspCode: 'mock-gsp',
  gspClientId: 'mock-client',
  gspClientSecret: 'mock-secret',
  gspUsername: 'mock-user',
  gspPassword: 'mock-password',
  irpEnv: 'sandbox',
})
const authResponse = (token = 'mock-token') => ({
  ok: true,
  status: 200,
  json: async () => ({ access_token: token, expires_in: 3600, token_type: 'Bearer' }),
})
const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})
const sale = {
  invoiceNumber: 'TEST-001',
  invoiceDate: '2026-11-25',
  partyName: 'Mock Buyer',
  totalAmount: 118,
  supplierGstin: '22AAAAA0000A1Z5',
  supplierName: 'Mock Seller',
  supplierStateCode: '22',
  items: [{ hsnCode: '1001', name: 'Mock item', quantity: 1, unit: 'PCS', taxableValue: 100, gstRate: 18 }],
}
const noTransport = {}

test('IRP submit authenticates and accepts a complete mocked provider response', async () => {
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    if (calls.length === 1) return authResponse('tenant-one-token')
    return jsonResponse({ Status: 1, Result: { Irn: validIrn, AckNo: 123456789, AckDt: '2026-11-25 10:30:00', SignedQRCode: 'mock-qr' } })
  }
  try {
    const result = await submitToIrp({ DocNo: 'TEST-001' }, config('mock-irp-success'))
    assert.equal(result.success, true)
    assert.equal(result.irn, validIrn.toUpperCase())
    assert.equal(result.ackNo, '123456789')
    assert.equal(calls.length, 2)
    assert.match(calls[0].url, /registration\/authenticate$/)
    assert.match(calls[1].url, /api\/v1\/einvoice$/)
    assert.equal(calls[1].options.headers.Authorization, 'Bearer tenant-one-token')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('IRP token cache is tenant-scoped and reuses a token only for the same tenant', async () => {
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    if (String(url).endsWith('/registration/authenticate')) return authResponse('cached-token')
    return jsonResponse({ Status: 0, Message: 'mock rejection' })
  }
  try {
    await submitToIrp({}, config('mock-cache-tenant-a'))
    await submitToIrp({}, config('mock-cache-tenant-a'))
    await submitToIrp({}, config('mock-cache-tenant-b'))
    assert.equal(calls.filter(url => url.endsWith('/registration/authenticate')).length, 2)
    assert.equal(calls.filter(url => url.endsWith('/api/v1/einvoice')).length, 3)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('IRP rejects authentication HTTP errors without submitting an invoice', async () => {
  let calls = 0
  globalThis.fetch = async () => { calls++; return jsonResponse({}, 401) }
  try {
    const result = await submitToIrp({}, config('mock-irp-auth-http'))
    assert.equal(result.success, false)
    assert.match(result.errorMessage, /authentication failed \(HTTP 401\)/)
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('IRP rejects malformed success payloads and preserves provider rejection messages', async () => {
  let submitCount = 0
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/registration/authenticate')) return authResponse('mock-irp-token')
    submitCount++
    return submitCount === 1
      ? jsonResponse({ Status: 1, Result: { Irn: 'invalid', AckNo: '', AckDt: '' } })
      : jsonResponse({ Status: 0, ErrorDetails: [{ ErrorMessage: 'Mock validation failure' }] })
  }
  try {
    const invalid = await submitToIrp({}, config('mock-irp-invalid-success'))
    assert.equal(invalid.success, false)
    assert.match(invalid.errorMessage, /without a valid 64-character IRN/)
    const rejected = await submitToIrp({}, config('mock-irp-provider-rejection'))
    assert.equal(rejected.success, false)
    assert.equal(rejected.errorMessage, 'Mock validation failure')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('IRP converts HTTP, malformed JSON, and network failures into safe failures', async (t) => {
  await t.test('provider HTTP error', async () => {
    globalThis.fetch = async (url) => String(url).endsWith('/registration/authenticate') ? authResponse('mock-irp-http') : jsonResponse({}, 503)
    const result = await submitToIrp({}, config('mock-irp-http-failure'))
    assert.equal(result.success, false)
    assert.match(result.errorMessage, /HTTP 503/)
  })
  await t.test('invalid authentication JSON', async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ access_token: '', expires_in: 0 }) })
    const result = await submitToIrp({}, config('mock-irp-invalid-auth-json'))
    assert.equal(result.success, false)
    assert.match(result.errorMessage, /invalid token response/)
  })
  await t.test('network rejection', async () => {
    globalThis.fetch = async () => { throw new Error('mock socket failure') }
    const result = await submitToIrp({}, config('mock-irp-network-failure'))
    assert.equal(result.success, false)
    assert.match(result.errorMessage, /mock socket failure/)
  })
  globalThis.fetch = originalFetch
})

test('EWB direct generation accepts a valid mocked 12-digit EWB response', async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return calls === 1 ? authResponse('mock-ewb-token') : jsonResponse({ Status: 1, Result: { EwbNo: '123456789012', EwbDate: '2026-11-25', EwbValidUpto: '2026-11-26' } })
  }
  try {
    const result = await generateEwbDirect(sale, noTransport, config('mock-ewb-success'))
    assert.equal(result.success, true)
    assert.equal(result.ewbNo, '123456789012')
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('EWB rejects malformed success responses and reports provider HTTP errors', async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    if (calls === 1 || calls === 3) return authResponse('mock-ewb-token-' + calls)
    return calls === 2
      ? jsonResponse({ Status: 1, Result: { EwbNo: '12345' } })
      : jsonResponse({}, 502)
  }
  try {
    const malformed = await generateEwbDirect(sale, noTransport, config('mock-ewb-invalid-success'))
    assert.equal(malformed.success, false)
    assert.match(malformed.errorMessage, /valid 12-digit EWB number/)
    const httpFailure = await generateEwbDirect(sale, noTransport, config('mock-ewb-http-failure'))
    assert.equal(httpFailure.success, false)
    assert.match(httpFailure.errorMessage, /HTTP 502/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('EWB returns MANUAL mode without configured tenant credentials and makes no network call', async () => {
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error('fetch must not be called') }
  try {
    const result = await generateEwbDirect(sale, noTransport, null)
    assert.equal(result.success, false)
    assert.equal(result.mode, 'MANUAL')
    assert.ok(result.ewbPayload)
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
