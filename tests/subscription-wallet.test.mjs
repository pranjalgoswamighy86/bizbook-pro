import test from 'node:test'
import assert from 'node:assert/strict'
import { allocateWalletUsage, sumWalletRemainingSeconds } from '../.test-build/subscription-wallet.js'

test('combines remaining seconds across all company wallet rows', () => {
  assert.equal(sumWalletRemainingSeconds([{ remainingSeconds: 3600 }, { remainingSeconds: 1800 }, { remainingSeconds: 0 }]), 5400)
})
test('ignores negative and invalid legacy balances when aggregating', () => {
  assert.equal(sumWalletRemainingSeconds([{ remainingSeconds: -50 }, { remainingSeconds: Number.NaN }, { remainingSeconds: 120 }]), 120)
})
test('allocates usage across multiple company wallets in order', () => {
  assert.deepEqual(allocateWalletUsage([{ id: 'company-a', remainingSeconds: 120 }, { id: 'company-b', remainingSeconds: 500 }], 200), [
    { id: 'company-a', secondsToDeduct: 120, remainingAfter: 0 },
    { id: 'company-b', secondsToDeduct: 80, remainingAfter: 420 },
  ])
})
test('does not allocate more seconds than the combined available balance', () => {
  assert.deepEqual(allocateWalletUsage([{ id: 'company-a', remainingSeconds: 0 }, { id: 'company-b', remainingSeconds: 90 }], 300), [{ id: 'company-b', secondsToDeduct: 90, remainingAfter: 0 }])
})
test('rejects invalid usage amounts', () => {
  assert.throws(() => allocateWalletUsage([], 0), RangeError)
  assert.throws(() => allocateWalletUsage([], 1.5), RangeError)
})
