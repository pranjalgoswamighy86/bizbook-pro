/**
 * Helpers for the shared subscription wallet used by a user's owned companies.
 * Older/migrated accounts may have a subscription row on more than one company.
 */
export interface SubscriptionWalletBalance {
  id: string
  remainingSeconds: number
}
export interface WalletUsageAllocation {
  id: string
  secondsToDeduct: number
  remainingAfter: number
}
export function sumWalletRemainingSeconds(subscriptions: Array<Pick<SubscriptionWalletBalance, 'remainingSeconds'>>): number {
  return subscriptions.reduce((total, subscription) => {
    const seconds = Number(subscription.remainingSeconds)
    return total + (Number.isFinite(seconds) ? Math.max(0, Math.trunc(seconds)) : 0)
  }, 0)
}
export function allocateWalletUsage(subscriptions: SubscriptionWalletBalance[], secondsUsed: number): WalletUsageAllocation[] {
  if (!Number.isInteger(secondsUsed) || secondsUsed <= 0) throw new RangeError('secondsUsed must be a positive whole number')
  let secondsLeft = secondsUsed
  const allocations: WalletUsageAllocation[] = []
  for (const subscription of subscriptions) {
    if (secondsLeft <= 0) break
    const available = Math.max(0, Math.trunc(Number(subscription.remainingSeconds) || 0))
    const secondsToDeduct = Math.min(available, secondsLeft)
    if (secondsToDeduct <= 0) continue
    allocations.push({ id: subscription.id, secondsToDeduct, remainingAfter: available - secondsToDeduct })
    secondsLeft -= secondsToDeduct
  }
  return allocations
}
