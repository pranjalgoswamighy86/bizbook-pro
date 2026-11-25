import test from 'node:test'
import assert from 'node:assert/strict'
import { decideRateLimit, rateLimitStoreUnavailable } from '../.test-build/rate-limit-policy.js'

test('allows requests up to the configured limit', () => {
  const result = decideRateLimit(10, 60_000, 10, 30_000)
  assert.equal(result.allowed, true)
  assert.equal(result.remaining, 0)
  assert.equal(result.statusCode, 200)
})

test('blocks the first request above the limit and reports remaining window', () => {
  const result = decideRateLimit(11, 60_000, 10, 30_000)
  assert.equal(result.allowed, false)
  assert.equal(result.remaining, 0)
  assert.equal(result.retryAfterSeconds, 30)
  assert.equal(result.statusCode, 429)
  assert.equal(result.reason, 'limit')
})

test('never returns a zero or negative retry interval for an expired blocked bucket', () => {
  const result = decideRateLimit(11, 10_000, 10, 20_000)
  assert.equal(result.retryAfterSeconds, 1)
})

test('fails closed with a service-unavailable result when storage is down', () => {
  const result = rateLimitStoreUnavailable()
  assert.equal(result.allowed, false)
  assert.equal(result.statusCode, 503)
  assert.equal(result.retryAfterSeconds, 30)
  assert.equal(result.reason, 'db-unavailable')
})
