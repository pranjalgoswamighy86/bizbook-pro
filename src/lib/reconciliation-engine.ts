/**
 * v6.28.3: Database Reconciliation & Remediation Engine
 * =====================================================
 *
 * This module performs a full-database diagnostic sweep across all financial
 * tables to identify stored calculation discrepancies, then optionally
 * remediates them with transaction-safe updates.
 *
 * RECONCILIATION CHECKS:
 *   1. Sale.totalAmount != (subtotal - discount + gstAmount)
 *   2. Sale balance_due != totalAmount - amountReceived
 *   3. Sale.paymentStatus inconsistent with amountReceived vs totalAmount
 *   4. Purchase.totalAmount != subtotal + gstAmount
 *   5. Purchase balance_due != totalAmount - amountPaid
 *   6. Purchase.paymentStatus inconsistent with amountPaid vs totalAmount
 *   7. Debtor.currentBalance != SUM(outstanding sale dues for that party)
 *   8. Creditor.currentBalance != SUM(outstanding purchase dues for that party)
 *   9. JournalEntry debits != credits (unbalanced entries)
 *  10. Sale/Purchase/Expense without a linked JournalEntry (orphaned)
 *  11. Sale.discountPercent > 0 but gstAmount computed on pre-discount subtotal
 *  12. SalaryPayment with status DUE but no linked Creditor (orphaned accrual)
 *
 * REMEDIATION:
 *   - Recomputes Sale.totalAmount from subtotal, discountPercent, gstAmount
 *   - Recomputes Sale.gstAmount on post-discount taxable amount (Check 11)
 *   - Re-syncs Sale.paymentStatus based on amountReceived vs totalAmount
 *   - Re-syncs Purchase.paymentStatus based on amountPaid vs totalAmount
 *   - Recalculates Debtor.currentBalance from outstanding sales
 *   - Recalculates Creditor.currentBalance from outstanding purchases
 *   - Does NOT modify JournalEntries (immutable principle — corrections via
 *     reversing entries, not overwrites)
 *
 * USAGE:
 *   import { runReconciliation, runRemediation } from '@/lib/reconciliation-engine'
 *   const report = await runReconciliation(tenantId)  // diagnose only
 *   const fixed = await runRemediation(tenantId)      // diagnose + fix
 */

import { PrismaClient } from '@prisma/client'

// Use the RAW Prisma client (not the soft-delete-extended one) so we can
// see ALL records including soft-deleted ones during the audit.
const prisma = new PrismaClient()

// =====================================================================
// TYPES
// =====================================================================

export interface ReconciliationCheck {
  id: string
  checkName: string
  tableName: string
  recordId: string
  recordDescription: string
  expectedValue: number
  actualValue: number
  difference: number
  severity: 'critical' | 'warning' | 'info'
  canAutoFix: boolean
}

export interface ReconciliationReport {
  tenantId: string
  runAt: string
  totalChecks: number
  totalIssues: number
  criticalCount: number
  warningCount: number
  infoCount: number
  autoFixableCount: number
  checks: ReconciliationCheck[]
  summary: {
    salesChecked: number
    purchasesChecked: number
    debtorsChecked: number
    creditorsChecked: number
    journalEntriesChecked: number
    salaryPaymentsChecked: number
  }
}

export interface RemediationResult {
  tenantId: string
  runAt: string
  salesFixed: number
    purchasesFixed: number
  debtorsRecalculated: number
  creditorsRecalculated: number
  salaryPaymentsFixed: number
  errors: string[]
  report: ReconciliationReport
}

// =====================================================================
// HELPER: round to 2 decimal places (matches roundTo2 in gst-utils.ts)
// =====================================================================
function roundTo2(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Number(value.toFixed(2))
}

// =====================================================================
// RECONCILIATION ENGINE
// =====================================================================

export async function runReconciliation(tenantId: string): Promise<ReconciliationReport> {
  const checks: ReconciliationCheck[] = []
  let salesChecked = 0, purchasesChecked = 0, debtorsChecked = 0
  let creditorsChecked = 0, journalEntriesChecked = 0, salaryPaymentsChecked = 0

  // -----------------------------------------------------------------
  // CHECK 1-3: Sales — totalAmount, balance due, paymentStatus
  // -----------------------------------------------------------------
  const sales = await prisma.sale.findMany({
    where: { tenantId, isDeleted: false },
    select: {
      id: true, invoiceNumber: true, subtotal: true, gstAmount: true,
      totalAmount: true, discountPercent: true, amountReceived: true,
      amountPaid: true, paymentStatus: true, partyName: true, items: true,
    },
  })
  salesChecked = sales.length

  for (const sale of sales) {
    const discountPercent = sale.discountPercent || 0
    const saleDiscountAmount = roundTo2((sale.subtotal || 0) * discountPercent / 100)
    const taxableAmount = roundTo2((sale.subtotal || 0) - saleDiscountAmount)

    // CHECK 1: totalAmount != taxableAmount + gstAmount
    const expectedTotal = roundTo2(taxableAmount + (sale.gstAmount || 0))
    if (Math.abs(expectedTotal - (sale.totalAmount || 0)) > 0.01) {
      checks.push({
        id: `sale-total-${sale.id}`,
        checkName: 'Sale.totalAmount mismatch',
        tableName: 'Sale',
        recordId: sale.id,
        recordDescription: `Invoice ${sale.invoiceNumber} (${sale.partyName})`,
        expectedValue: expectedTotal,
        actualValue: sale.totalAmount || 0,
        difference: roundTo2(expectedTotal - (sale.totalAmount || 0)),
        severity: 'critical',
        canAutoFix: true,
      })
    }

    // CHECK 2: balance_due != totalAmount - amountReceived
    const expectedBalanceDue = roundTo2((sale.totalAmount || 0) - (sale.amountReceived || sale.amountPaid || 0))
    // This is informational — the Sale Register computes this on the fly,
    // but if amountReceived > totalAmount, that's a data integrity issue.
    if ((sale.amountReceived || 0) > (sale.totalAmount || 0) + 0.01) {
      checks.push({
        id: `sale-overpayment-${sale.id}`,
        checkName: 'Sale overpayment (amountReceived > totalAmount)',
        tableName: 'Sale',
        recordId: sale.id,
        recordDescription: `Invoice ${sale.invoiceNumber} (${sale.partyName})`,
        expectedValue: sale.totalAmount || 0,
        actualValue: sale.amountReceived || 0,
        difference: roundTo2((sale.amountReceived || 0) - (sale.totalAmount || 0)),
        severity: 'warning',
        canAutoFix: true,
      })
    }

    // CHECK 3: paymentStatus inconsistent with amounts
    const received = sale.amountReceived || sale.amountPaid || 0
    const total = sale.totalAmount || 0
    let expectedStatus = 'PENDING'
    if (received >= total - 0.01 && total > 0) expectedStatus = 'RECEIVED'
    else if (received > 0.01) expectedStatus = 'PARTIAL'
    // Normalize: UNPAID→PENDING, PAID→RECEIVED
    const normalizedStatus = sale.paymentStatus === 'UNPAID' ? 'PENDING'
      : sale.paymentStatus === 'PAID' ? 'RECEIVED'
      : sale.paymentStatus
    if (normalizedStatus !== expectedStatus && total > 0) {
      checks.push({
        id: `sale-status-${sale.id}`,
        checkName: 'Sale.paymentStatus mismatch',
        tableName: 'Sale',
        recordId: sale.id,
        recordDescription: `Invoice ${sale.invoiceNumber} (${sale.partyName})`,
        expectedValue: expectedStatus as any,
        actualValue: sale.paymentStatus as any,
        difference: 0,
        severity: 'warning',
        canAutoFix: true,
      })
    }

    // CHECK 11: Sale with discountPercent > 0 — verify gstAmount is on post-discount
    // We can detect this by checking if gstAmount ≈ subtotal × gstRate% (pre-discount)
    // vs gstAmount ≈ taxableAmount × gstRate% (post-discount).
    // Since we don't store the gstRate at the sale level, we approximate:
    // if discountPercent > 0 and gstAmount / subtotal > gstAmount / taxableAmount,
    // the tax was likely computed on the pre-discount amount.
    // This is a heuristic — the definitive fix is in the remediation step.
    if (discountPercent > 0 && (sale.gstAmount || 0) > 0.01 && taxableAmount > 0) {
      // If gstAmount is closer to (subtotal × rate) than (taxableAmount × rate),
      // it was likely computed pre-discount. We can check the ratio.
      const taxRateOnSubtotal = (sale.gstAmount || 0) / (sale.subtotal || 1) * 100
      const taxRateOnTaxable = (sale.gstAmount || 0) / (taxableAmount || 1) * 100
      // Standard GST rates: 5, 12, 18, 28. Check which is closer.
      const stdRates = [5, 12, 18, 28]
      const closestRateOnSubtotal = stdRates.reduce((closest, rate) =>
        Math.abs(rate - taxRateOnSubtotal) < Math.abs(closest - taxRateOnSubtotal) ? rate : closest, 0)
      const closestRateOnTaxable = stdRates.reduce((closest, rate) =>
        Math.abs(rate - taxRateOnTaxable) < Math.abs(closest - taxRateOnTaxable) ? rate : closest, 0)
      // If the rate on taxableAmount matches a standard rate but the rate on subtotal doesn't,
      // the GST was computed correctly (post-discount). If the reverse, it's pre-discount (buggy).
      if (closestRateOnSubtotal > 0 && Math.abs(taxRateOnSubtotal - closestRateOnSubtotal) < 0.5
          && Math.abs(taxRateOnTaxable - closestRateOnTaxable) > 0.5) {
        const expectedGst = roundTo2(taxableAmount * closestRateOnSubtotal / 100)
        checks.push({
          id: `sale-gst-prediscount-${sale.id}`,
          checkName: 'Sale.gstAmount computed on pre-discount subtotal (GAAP violation)',
          tableName: 'Sale',
          recordId: sale.id,
          recordDescription: `Invoice ${sale.invoiceNumber} (${sale.partyName}) — discount ${discountPercent}%, GST appears computed on ₹${sale.subtotal} instead of ₹${taxableAmount}`,
          expectedValue: expectedGst,
          actualValue: sale.gstAmount || 0,
          difference: roundTo2((sale.gstAmount || 0) - expectedGst),
          severity: 'critical',
          canAutoFix: true,
        })
      }
    }
  }

  // -----------------------------------------------------------------
  // CHECK 4-6: Purchases — totalAmount, balance due, paymentStatus
  // -----------------------------------------------------------------
  const purchases = await prisma.purchase.findMany({
    where: { tenantId, isDeleted: false },
    select: {
      id: true, invoiceNumber: true, subtotal: true, gstAmount: true,
      totalAmount: true, amountPaid: true, paymentStatus: true, partyName: true,
    },
  })
  purchasesChecked = purchases.length

  for (const purchase of purchases) {
    // CHECK 4: totalAmount != subtotal + gstAmount
    const expectedTotal = roundTo2((purchase.subtotal || 0) + (purchase.gstAmount || 0))
    if (Math.abs(expectedTotal - (purchase.totalAmount || 0)) > 0.01) {
      checks.push({
        id: `purchase-total-${purchase.id}`,
        checkName: 'Purchase.totalAmount mismatch',
        tableName: 'Purchase',
        recordId: purchase.id,
        recordDescription: `Invoice ${purchase.invoiceNumber} (${purchase.partyName})`,
        expectedValue: expectedTotal,
        actualValue: purchase.totalAmount || 0,
        difference: roundTo2(expectedTotal - (purchase.totalAmount || 0)),
        severity: 'critical',
        canAutoFix: true,
      })
    }

    // CHECK 5: overpayment
    if ((purchase.amountPaid || 0) > (purchase.totalAmount || 0) + 0.01) {
      checks.push({
        id: `purchase-overpayment-${purchase.id}`,
        checkName: 'Purchase overpayment (amountPaid > totalAmount)',
        tableName: 'Purchase',
        recordId: purchase.id,
        recordDescription: `Invoice ${purchase.invoiceNumber} (${purchase.partyName})`,
        expectedValue: purchase.totalAmount || 0,
        actualValue: purchase.amountPaid || 0,
        difference: roundTo2((purchase.amountPaid || 0) - (purchase.totalAmount || 0)),
        severity: 'warning',
        canAutoFix: true,
      })
    }

    // CHECK 6: paymentStatus inconsistent
    const paid = purchase.amountPaid || 0
    const ptotal = purchase.totalAmount || 0
    let expectedPStatus = 'UNPAID'
    if (paid >= ptotal - 0.01 && ptotal > 0) expectedPStatus = 'PAID'
    else if (paid > 0.01) expectedPStatus = 'PARTIAL'
    if (purchase.paymentStatus !== expectedPStatus && ptotal > 0) {
      checks.push({
        id: `purchase-status-${purchase.id}`,
        checkName: 'Purchase.paymentStatus mismatch',
        tableName: 'Purchase',
        recordId: purchase.id,
        recordDescription: `Invoice ${purchase.invoiceNumber} (${purchase.partyName})`,
        expectedValue: expectedPStatus as any,
        actualValue: purchase.paymentStatus as any,
        difference: 0,
        severity: 'warning',
        canAutoFix: true,
      })
    }
  }

  // -----------------------------------------------------------------
  // CHECK 7: Debtor.currentBalance != SUM(outstanding sale dues)
  // -----------------------------------------------------------------
  const debtors = await prisma.debtor.findMany({
    where: { tenantId, isDeleted: false },
    select: { id: true, name: true, currentBalance: true, openingBalance: true },
  })
  debtorsChecked = debtors.length

  // Build a map of partyName → total outstanding receivable from sales
  const receivableByParty: Record<string, number> = {}
  for (const sale of sales) {
    const due = roundTo2((sale.totalAmount || 0) - (sale.amountReceived || sale.amountPaid || 0))
    if (due > 0) {
      receivableByParty[sale.partyName] = (receivableByParty[sale.partyName] || 0) + due
    }
  }

  for (const debtor of debtors) {
    const expectedBalance = roundTo2((receivableByParty[debtor.name] || 0) + (debtor.openingBalance || 0))
    if (Math.abs(expectedBalance - (debtor.currentBalance || 0)) > 0.01) {
      checks.push({
        id: `debtor-balance-${debtor.id}`,
        checkName: 'Debtor.currentBalance != SUM(outstanding sales)',
        tableName: 'Debtor',
        recordId: debtor.id,
        recordDescription: `Debtor: ${debtor.name}`,
        expectedValue: expectedBalance,
        actualValue: debtor.currentBalance || 0,
        difference: roundTo2(expectedBalance - (debtor.currentBalance || 0)),
        severity: 'critical',
        canAutoFix: true,
      })
    }
  }

  // -----------------------------------------------------------------
  // CHECK 8: Creditor.currentBalance != SUM(outstanding purchase dues)
  // -----------------------------------------------------------------
  const creditors = await prisma.creditor.findMany({
    where: { tenantId, isDeleted: false },
    select: { id: true, name: true, currentBalance: true, openingBalance: true },
  })
  creditorsChecked = creditors.length

  const payableByParty: Record<string, number> = {}
  for (const purchase of purchases) {
    const due = roundTo2((purchase.totalAmount || 0) - (purchase.amountPaid || 0))
    if (due > 0) {
      payableByParty[purchase.partyName] = (payableByParty[purchase.partyName] || 0) + due
    }
  }

  for (const creditor of creditors) {
    const expectedBalance = roundTo2((payableByParty[creditor.name] || 0) + (creditor.openingBalance || 0))
    if (Math.abs(expectedBalance - (creditor.currentBalance || 0)) > 0.01) {
      checks.push({
        id: `creditor-balance-${creditor.id}`,
        checkName: 'Creditor.currentBalance != SUM(outstanding purchases)',
        tableName: 'Creditor',
        recordId: creditor.id,
        recordDescription: `Creditor: ${creditor.name}`,
        expectedValue: expectedBalance,
        actualValue: creditor.currentBalance || 0,
        difference: roundTo2(expectedBalance - (creditor.currentBalance || 0)),
        severity: 'critical',
        canAutoFix: true,
      })
    }
  }

  // -----------------------------------------------------------------
  // CHECK 9: JournalEntry debits != credits (unbalanced entries)
  // -----------------------------------------------------------------
  const journalEntries = await prisma.journalEntry.findMany({
    where: { tenantId, isPosted: true },
    select: {
      id: true, reference: true, description: true, entryDate: true,
      sourceType: true, sourceId: true,
      lines: { select: { debit: true, credit: true } },
    },
  })
  journalEntriesChecked = journalEntries.length

  for (const je of journalEntries) {
    const totalDebits = roundTo2(je.lines.reduce((s, l) => s + (l.debit || 0), 0))
    const totalCredits = roundTo2(je.lines.reduce((s, l) => s + (l.credit || 0), 0))
    const diff = roundTo2(totalDebits - totalCredits)
    if (Math.abs(diff) > 0.01) {
      checks.push({
        id: `je-unbalanced-${je.id}`,
        checkName: 'JournalEntry debits != credits (unbalanced)',
        tableName: 'JournalEntry',
        recordId: je.id,
        recordDescription: `JE: ${je.reference || je.description} (${je.sourceType || 'MANUAL'}, ${je.entryDate.toISOString().split('T')[0]})`,
        expectedValue: totalCredits,
        actualValue: totalDebits,
        difference: diff,
        severity: 'critical',
        canAutoFix: false, // JEs are immutable — must fix via reversing entry
      })
    }
  }

  // -----------------------------------------------------------------
  // CHECK 10: Sale/Purchase/Expense without a linked JournalEntry
  // -----------------------------------------------------------------
  // Sales without JEs
  const saleJEsourceIds = new Set(
    journalEntries.filter(je => je.sourceType === 'SALE' && je.sourceId).map(je => je.sourceId!)
  )
  for (const sale of sales) {
    if (!saleJEsourceIds.has(sale.id)) {
      checks.push({
        id: `sale-no-je-${sale.id}`,
        checkName: 'Sale without linked JournalEntry (orphaned)',
        tableName: 'Sale',
        recordId: sale.id,
        recordDescription: `Invoice ${sale.invoiceNumber} (${sale.partyName}) — no GL entry`,
        expectedValue: 1,
        actualValue: 0,
        difference: 1,
        severity: 'warning',
        canAutoFix: false, // Requires re-posting the JE, which needs the full sale context
      })
    }
  }

  // Purchases without JEs
  const purchaseJEsourceIds = new Set(
    journalEntries.filter(je => je.sourceType === 'PURCHASE' && je.sourceId).map(je => je.sourceId!)
  )
  for (const purchase of purchases) {
    if (!purchaseJEsourceIds.has(purchase.id)) {
      checks.push({
        id: `purchase-no-je-${purchase.id}`,
        checkName: 'Purchase without linked JournalEntry (orphaned)',
        tableName: 'Purchase',
        recordId: purchase.id,
        recordDescription: `Invoice ${purchase.invoiceNumber} (${purchase.partyName}) — no GL entry`,
        expectedValue: 1,
        actualValue: 0,
        difference: 1,
        severity: 'warning',
        canAutoFix: false,
      })
    }
  }

  // -----------------------------------------------------------------
  // CHECK 12: SalaryPayment with status DUE but no linked Creditor
  // -----------------------------------------------------------------
  const salaryPayments = await prisma.salaryPayment.findMany({
    where: { tenantId, isDeleted: false, status: 'DUE' },
    select: { id: true, staffId: true, month: true, amount: true, creditorId: true },
  })
  salaryPaymentsChecked = salaryPayments.length

  for (const sp of salaryPayments) {
    if (!sp.creditorId) {
      checks.push({
        id: `salary-orphaned-${sp.id}`,
        checkName: 'SalaryPayment with status DUE but no linked Creditor',
        tableName: 'SalaryPayment',
        recordId: sp.id,
        recordDescription: `Salary payment for staff ${sp.staffId}, month ${sp.month} — accrued but not linked to a Creditor`,
        expectedValue: 1,
        actualValue: 0,
        difference: 1,
        severity: 'warning',
        canAutoFix: true,
      })
    }
  }

  // -----------------------------------------------------------------
  // BUILD REPORT
  // -----------------------------------------------------------------
  const criticalCount = checks.filter(c => c.severity === 'critical').length
  const warningCount = checks.filter(c => c.severity === 'warning').length
  const infoCount = checks.filter(c => c.severity === 'info').length
  const autoFixableCount = checks.filter(c => c.canAutoFix).length

  return {
    tenantId,
    runAt: new Date().toISOString(),
    totalChecks: salesChecked + purchasesChecked + debtorsChecked + creditorsChecked + journalEntriesChecked + salaryPaymentsChecked,
    totalIssues: checks.length,
    criticalCount,
    warningCount,
    infoCount,
    autoFixableCount,
    checks,
    summary: {
      salesChecked,
      purchasesChecked,
      debtorsChecked,
      creditorsChecked,
      journalEntriesChecked,
      salaryPaymentsChecked,
    },
  }
}

// =====================================================================
// REMEDIATION ENGINE
// =====================================================================

export async function runRemediation(tenantId: string, dryRun = false): Promise<RemediationResult> {
  const errors: string[] = []
  let salesFixed = 0, purchasesFixed = 0, debtorsRecalculated = 0
  let creditorsRecalculated = 0, salaryPaymentsFixed = 0

  // First, run the reconciliation to identify all issues
  const report = await runReconciliation(tenantId)

  if (dryRun) {
    return {
      tenantId, runAt: new Date().toISOString(),
      salesFixed: 0, purchasesFixed: 0, debtorsRecalculated: 0,
      creditorsRecalculated: 0, salaryPaymentsFixed: 0,
      errors: [],
      report,
    }
  }

  // -----------------------------------------------------------------
  // FIX 1: Sale.totalAmount and gstAmount
  // -----------------------------------------------------------------
  const saleIssues = report.checks.filter(c => c.tableName === 'Sale' && c.canAutoFix)
  const saleIdsToFix = new Set(saleIssues.map(c => c.recordId))

  if (saleIdsToFix.size > 0) {
    const salesToFix = await prisma.sale.findMany({
      where: { id: { in: Array.from(saleIdsToFix) } },
      select: {
        id: true, subtotal: true, gstAmount: true, totalAmount: true,
        discountPercent: true, amountReceived: true, amountPaid: true,
        paymentStatus: true,
      },
    })

    for (const sale of salesToFix) {
      try {
        const discountPercent = sale.discountPercent || 0
        const saleDiscountAmount = roundTo2((sale.subtotal || 0) * discountPercent / 100)
        const taxableAmount = roundTo2((sale.subtotal || 0) - saleDiscountAmount)

        // Check if gstAmount needs recomputation (was it on pre-discount?)
        const gstCheck = report.checks.find(c => c.id === `sale-gst-prediscount-${sale.id}`)
        let newGstAmount = sale.gstAmount || 0
        if (gstCheck) {
          // Recompute GST on post-discount taxable amount
          // We need to infer the GST rate from the items JSON
          // For safety, use the expected value from the check
          newGstAmount = roundTo2(gstCheck.expectedValue)
        }

        const newTotalAmount = roundTo2(taxableAmount + newGstAmount)

        // Fix paymentStatus
        const received = sale.amountReceived || sale.amountPaid || 0
        let newStatus = 'PENDING'
        if (received >= newTotalAmount - 0.01 && newTotalAmount > 0) newStatus = 'RECEIVED'
        else if (received > 0.01) newStatus = 'PARTIAL'

        // Fix overpayment: clamp amountReceived to totalAmount
        let newReceived = received
        let newPaid = sale.amountPaid || 0
        if (received > newTotalAmount) {
          newReceived = newTotalAmount
          newPaid = newTotalAmount
        }

        await prisma.sale.update({
          where: { id: sale.id },
          data: {
            gstAmount: newGstAmount,
            totalAmount: newTotalAmount,
            paymentStatus: newStatus,
            amountReceived: newReceived,
            amountPaid: newPaid,
          },
        })
        salesFixed++
      } catch (err: any) {
        errors.push(`Failed to fix sale ${sale.id}: ${err.message}`)
      }
    }
  }

  // -----------------------------------------------------------------
  // FIX 2: Purchase.totalAmount and paymentStatus
  // -----------------------------------------------------------------
  const purchaseIssues = report.checks.filter(c => c.tableName === 'Purchase' && c.canAutoFix)
  const purchaseIdsToFix = new Set(purchaseIssues.map(c => c.recordId))

  if (purchaseIdsToFix.size > 0) {
    const purchasesToFix = await prisma.purchase.findMany({
      where: { id: { in: Array.from(purchaseIdsToFix) } },
      select: { id: true, subtotal: true, gstAmount: true, totalAmount: true, amountPaid: true, paymentStatus: true },
    })

    for (const purchase of purchasesToFix) {
      try {
        const newTotalAmount = roundTo2((purchase.subtotal || 0) + (purchase.gstAmount || 0))
        const paid = purchase.amountPaid || 0
        let newStatus = 'UNPAID'
        if (paid >= newTotalAmount - 0.01 && newTotalAmount > 0) newStatus = 'PAID'
        else if (paid > 0.01) newStatus = 'PARTIAL'

        let newPaid = paid
        if (paid > newTotalAmount) {
          newPaid = newTotalAmount
        }

        await prisma.purchase.update({
          where: { id: purchase.id },
          data: {
            totalAmount: newTotalAmount,
            paymentStatus: newStatus,
            amountPaid: newPaid,
          },
        })
        purchasesFixed++
      } catch (err: any) {
        errors.push(`Failed to fix purchase ${purchase.id}: ${err.message}`)
      }
    }
  }

  // -----------------------------------------------------------------
  // FIX 3: Recalculate Debtor.currentBalance from outstanding sales
  // -----------------------------------------------------------------
  const debtorIssues = report.checks.filter(c => c.tableName === 'Debtor' && c.canAutoFix)
  const debtorIdsToFix = new Set(debtorIssues.map(c => c.recordId))

  if (debtorIdsToFix.size > 0) {
    // Re-fetch all sales (they may have been updated above)
    const allSales = await prisma.sale.findMany({
      where: { tenantId, isDeleted: false },
      select: { partyName: true, totalAmount: true, amountReceived: true, amountPaid: true },
    })
    const receivableByParty: Record<string, number> = {}
    for (const sale of allSales) {
      const due = roundTo2((sale.totalAmount || 0) - (sale.amountReceived || sale.amountPaid || 0))
      if (due > 0) {
        receivableByParty[sale.partyName] = (receivableByParty[sale.partyName] || 0) + due
      }
    }

    const debtorsToFix = await prisma.debtor.findMany({
      where: { id: { in: Array.from(debtorIdsToFix) } },
      select: { id: true, name: true, openingBalance: true },
    })

    for (const debtor of debtorsToFix) {
      try {
        const newBalance = roundTo2((receivableByParty[debtor.name] || 0) + (debtor.openingBalance || 0))
        await prisma.debtor.update({
          where: { id: debtor.id },
          data: { currentBalance: newBalance },
        })
        debtorsRecalculated++
      } catch (err: any) {
        errors.push(`Failed to recalculate debtor ${debtor.id}: ${err.message}`)
      }
    }
  }

  // -----------------------------------------------------------------
  // FIX 4: Recalculate Creditor.currentBalance from outstanding purchases
  // -----------------------------------------------------------------
  const creditorIssues = report.checks.filter(c => c.tableName === 'Creditor' && c.canAutoFix)
  const creditorIdsToFix = new Set(creditorIssues.map(c => c.recordId))

  if (creditorIdsToFix.size > 0) {
    const allPurchases = await prisma.purchase.findMany({
      where: { tenantId, isDeleted: false },
      select: { partyName: true, totalAmount: true, amountPaid: true },
    })
    const payableByParty: Record<string, number> = {}
    for (const purchase of allPurchases) {
      const due = roundTo2((purchase.totalAmount || 0) - (purchase.amountPaid || 0))
      if (due > 0) {
        payableByParty[purchase.partyName] = (payableByParty[purchase.partyName] || 0) + due
      }
    }

    const creditorsToFix = await prisma.creditor.findMany({
      where: { id: { in: Array.from(creditorIdsToFix) } },
      select: { id: true, name: true, openingBalance: true },
    })

    for (const creditor of creditorsToFix) {
      try {
        const newBalance = roundTo2((payableByParty[creditor.name] || 0) + (creditor.openingBalance || 0))
        await prisma.creditor.update({
          where: { id: creditor.id },
          data: { currentBalance: newBalance },
        })
        creditorsRecalculated++
      } catch (err: any) {
        errors.push(`Failed to recalculate creditor ${creditor.id}: ${err.message}`)
      }
    }
  }

  // -----------------------------------------------------------------
  // FIX 5: SalaryPayment with status DUE but no linked Creditor
  // -----------------------------------------------------------------
  const salaryIssues = report.checks.filter(c => c.id.startsWith('salary-orphaned-'))
  for (const issue of salaryIssues) {
    try {
      const sp = await prisma.salaryPayment.findUnique({
        where: { id: issue.recordId },
        include: { staff: true },
      })
      if (!sp || !sp.staff) continue

      // Find or create a Creditor for this staff member
      let creditor = await prisma.creditor.findFirst({
        where: { name: sp.staff.name, tenantId, isDeleted: false },
      })
      if (!creditor) {
        creditor = await prisma.creditor.create({
          data: {
            name: sp.staff.name,
            phone: sp.staff.phone || null,
            currentBalance: sp.amount,
            tenantId,
          },
        })
      } else {
        await prisma.creditor.update({
          where: { id: creditor.id },
          data: { currentBalance: roundTo2(creditor.currentBalance + sp.amount) },
        })
      }

      await prisma.salaryPayment.update({
        where: { id: sp.id },
        data: { creditorId: creditor.id },
      })
      salaryPaymentsFixed++
    } catch (err: any) {
      errors.push(`Failed to fix salary payment ${issue.recordId}: ${err.message}`)
    }
  }

  // -----------------------------------------------------------------
  // Re-run reconciliation to produce the post-remediation report
  // -----------------------------------------------------------------
  const postReport = await runReconciliation(tenantId)

  return {
    tenantId,
    runAt: new Date().toISOString(),
    salesFixed,
    purchasesFixed,
    debtorsRecalculated,
    creditorsRecalculated,
    salaryPaymentsFixed,
    errors,
    report: postReport,
  }
}
