import { roundTo2 } from '@/lib/gst-utils'

// =====================================================================
// v6.28.6: Journal Entry Balance Assertion Helper
// =====================================================================
// Ensures that every JE posted to the GL has total debits === total credits
// BEFORE the Prisma create call. This catches calculation bugs at the point
// of posting rather than discovering them later in the Trial Balance.
//
// Usage:
//   assertJEBalance(jeLines)  // throws if unbalanced
//   await tx.journalEntry.create({ data: { ... } })
// =====================================================================

export interface JELineInput {
  accountId: string
  debit: number
  credit: number
  description?: string
}

export function assertJEBalance(lines: JELineInput[], context?: string): void {
  const totalDebits = roundTo2(lines.reduce((s, l) => s + (l.debit || 0), 0))
  const totalCredits = roundTo2(lines.reduce((s, l) => s + (l.credit || 0), 0))
  const diff = roundTo2(totalDebits - totalCredits)
  if (Math.abs(diff) > 0.01) {
    const msg = `[JE BALANCE ERROR] ${context || 'Journal Entry'}: debits=${totalDebits}, credits=${totalCredits}, diff=${diff}. Lines: ${JSON.stringify(lines.map(l => ({ d: l.debit, c: l.credit })))}`
    console.error(msg)
    throw new Error(msg)
  }
}
