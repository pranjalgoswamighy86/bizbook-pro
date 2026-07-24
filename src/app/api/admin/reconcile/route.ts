import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndRole, writeAuditLog } from '@/lib/api-helpers'
import { roundTo2 } from '@/lib/gst-utils'

// =====================================================================
// v6.28.3: Comprehensive Database Reconciliation & Remediation API
// =====================================================================
// This endpoint performs a full-database diagnostic sweep across all
// financial tables to identify stored calculation discrepancies, then
// optionally remediates them with transaction-safe updates.
//
// Actions:
//   audit     — Run read-only reconciliation, return all discrepancies
//   remediate — Fix all identified discrepancies (transaction-safe)
//
// All monetary comparisons use a ₹0.01 tolerance to handle historical
// floating-point rounding differences. Remediation rounds to 2 decimals
// using the same roundTo2() helper used everywhere else in the app.
// =====================================================================

const TOLERANCE = 0.01 // ₹0.01 tolerance for floating-point comparisons

interface Discrepancy {
  table: string
  id: string
  field: string
  storedValue: number
  computedValue: number
  difference: number
  description: string
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    // Only MAIN_ADMIN can run reconciliation
    const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
    if (access instanceof NextResponse) return access

    if (action === 'audit') {
      return await runAudit(access.tenantId, access.userId, access.user.name)
    }

    if (action === 'remediate') {
      return await runRemediation(access.tenantId, access.userId, access.user.name, body.dryRun !== false)
    }

    return NextResponse.json({ error: 'Invalid action. Use "audit" or "remediate".' }, { status: 400 })
  } catch (error: any) {
    console.error('[RECONCILE] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

// =====================================================================
// AUDIT — read-only sweep of all financial tables
// =====================================================================
async function runAudit(tenantId: string, userId: string, userName: string) {
  const discrepancies: Discrepancy[] = []
  const stats: Record<string, { total: number; checked: number; flagged: number }> = {}

  // ---- 1. SALES: totalAmount vs subtotal - discount + gstAmount ----
  const sales = await db.sale.findMany({
    where: { tenantId, isDeleted: false },
    select: {
      id: true, invoiceNumber: true, subtotal: true, gstAmount: true,
      totalAmount: true, discountPercent: true, amountReceived: true, amountPaid: true,
      paymentStatus: true,
    },
  })
  stats.sales = { total: sales.length, checked: sales.length, flagged: 0 }
  for (const s of sales) {
    // Check 1a: totalAmount should = (subtotal - discountAmount) + gstAmount
    const discountAmount = roundTo2((s.subtotal || 0) * (s.discountPercent || 0) / 100)
    const expectedTotal = roundTo2((s.subtotal || 0) - discountAmount + (s.gstAmount || 0))
    if (Math.abs((s.totalAmount || 0) - expectedTotal) > TOLERANCE) {
      discrepancies.push({
        table: 'Sale', id: s.id, field: 'totalAmount',
        storedValue: s.totalAmount || 0, computedValue: expectedTotal,
        difference: roundTo2((s.totalAmount || 0) - expectedTotal),
        description: `Sale ${s.invoiceNumber}: totalAmount=${s.totalAmount} but should be subtotal(${s.subtotal}) - discount(${discountAmount}) + gst(${s.gstAmount}) = ${expectedTotal}`,
      })
      stats.sales.flagged++
    }

    // Check 1b: amountPaid should match amountReceived (backward-compat field)
    if (Math.abs((s.amountReceived || 0) - (s.amountPaid || 0)) > TOLERANCE) {
      discrepancies.push({
        table: 'Sale', id: s.id, field: 'amountPaid',
        storedValue: s.amountPaid || 0, computedValue: s.amountReceived || 0,
        difference: roundTo2((s.amountPaid || 0) - (s.amountReceived || 0)),
        description: `Sale ${s.invoiceNumber}: amountPaid=${s.amountPaid} but amountReceived=${s.amountReceived} — these should match`,
      })
      stats.sales.flagged++
    }

    // Check 1c: paymentStatus consistency
    const received = s.amountReceived || s.amountPaid || 0
    const total = s.totalAmount || 0
    let expectedStatus = 'PENDING'
    if (received >= total && total > 0) expectedStatus = 'RECEIVED'
    else if (received > 0) expectedStatus = 'PARTIAL'
    const normalizedStatus = (s.paymentStatus === 'PAID' ? 'RECEIVED' : s.paymentStatus === 'UNPAID' ? 'PENDING' : s.paymentStatus)
    if (normalizedStatus !== expectedStatus && Math.abs(received - total) > TOLERANCE) {
      discrepancies.push({
        table: 'Sale', id: s.id, field: 'paymentStatus',
        storedValue: 0, computedValue: 0, difference: 0,
        description: `Sale ${s.invoiceNumber}: paymentStatus="${s.paymentStatus}" but should be "${expectedStatus}" (received=${received}, total=${total})`,
      })
      stats.sales.flagged++
    }
  }

  // ---- 2. PURCHASES: totalAmount vs subtotal + gstAmount ----
  const purchases = await db.purchase.findMany({
    where: { tenantId, isDeleted: false },
    select: {
      id: true, invoiceNumber: true, subtotal: true, gstAmount: true,
      totalAmount: true, amountPaid: true, paymentStatus: true,
    },
  })
  stats.purchases = { total: purchases.length, checked: purchases.length, flagged: 0 }
  for (const p of purchases) {
    const expectedTotal = roundTo2((p.subtotal || 0) + (p.gstAmount || 0))
    if (Math.abs((p.totalAmount || 0) - expectedTotal) > TOLERANCE) {
      discrepancies.push({
        table: 'Purchase', id: p.id, field: 'totalAmount',
        storedValue: p.totalAmount || 0, computedValue: expectedTotal,
        difference: roundTo2((p.totalAmount || 0) - expectedTotal),
        description: `Purchase ${p.invoiceNumber}: totalAmount=${p.totalAmount} but should be subtotal(${p.subtotal}) + gst(${p.gstAmount}) = ${expectedTotal}`,
      })
      stats.purchases.flagged++
    }

    // Check paymentStatus consistency
    const paid = p.amountPaid || 0
    const total = p.totalAmount || 0
    let expectedStatus = 'UNPAID'
    if (paid >= total && total > 0) expectedStatus = 'PAID'
    else if (paid > 0) expectedStatus = 'PARTIAL'
    if (p.paymentStatus !== expectedStatus && Math.abs(paid - total) > TOLERANCE) {
      discrepancies.push({
        table: 'Purchase', id: p.id, field: 'paymentStatus',
        storedValue: 0, computedValue: 0, difference: 0,
        description: `Purchase ${p.invoiceNumber}: paymentStatus="${p.paymentStatus}" but should be "${expectedStatus}" (paid=${paid}, total=${total})`,
      })
      stats.purchases.flagged++
    }
  }

  // ---- 3. RECEIVABLES: Debtor.currentBalance vs sum of outstanding sale dues ----
  const debtors = await db.debtor.findMany({
    where: { tenantId, isDeleted: false },
    select: { id: true, name: true, openingBalance: true, currentBalance: true },
  })
  const outstandingSales = await db.sale.findMany({
    where: { tenantId, isDeleted: false, paymentStatus: { not: 'RECEIVED' } },
    select: { partyName: true, totalAmount: true, amountReceived: true, amountPaid: true },
  })
  const receivableByParty: Record<string, number> = {}
  for (const s of outstandingSales) {
    const due = (s.totalAmount || 0) - (s.amountReceived || s.amountPaid || 0)
    if (due > 0) receivableByParty[s.partyName] = (receivableByParty[s.partyName] || 0) + due
  }
  stats.debtors = { total: debtors.length, checked: debtors.length, flagged: 0 }
  for (const d of debtors) {
    const expectedBalance = roundTo2((receivableByParty[d.name] || 0) + (d.openingBalance || 0))
    if (Math.abs((d.currentBalance || 0) - expectedBalance) > TOLERANCE) {
      discrepancies.push({
        table: 'Debtor', id: d.id, field: 'currentBalance',
        storedValue: d.currentBalance || 0, computedValue: expectedBalance,
        difference: roundTo2((d.currentBalance || 0) - expectedBalance),
        description: `Debtor "${d.name}": currentBalance=${d.currentBalance} but should be outstanding_sales(${receivableByParty[d.name] || 0}) + opening(${d.openingBalance || 0}) = ${expectedBalance}`,
      })
      stats.debtors.flagged++
    }
  }

  // ---- 4. PAYABLES: Creditor.currentBalance vs sum of outstanding purchase dues ----
  const creditors = await db.creditor.findMany({
    where: { tenantId, isDeleted: false },
    select: { id: true, name: true, openingBalance: true, currentBalance: true },
  })
  const outstandingPurchases = await db.purchase.findMany({
    where: { tenantId, isDeleted: false, paymentStatus: { not: 'PAID' } },
    select: { partyName: true, totalAmount: true, amountPaid: true },
  })
  const payableByParty: Record<string, number> = {}
  for (const p of outstandingPurchases) {
    const due = (p.totalAmount || 0) - (p.amountPaid || 0)
    if (due > 0) payableByParty[p.partyName] = (payableByParty[p.partyName] || 0) + due
  }
  stats.creditors = { total: creditors.length, checked: creditors.length, flagged: 0 }
  for (const c of creditors) {
    const expectedBalance = roundTo2((payableByParty[c.name] || 0) + (c.openingBalance || 0))
    if (Math.abs((c.currentBalance || 0) - expectedBalance) > TOLERANCE) {
      discrepancies.push({
        table: 'Creditor', id: c.id, field: 'currentBalance',
        storedValue: c.currentBalance || 0, computedValue: expectedBalance,
        difference: roundTo2((c.currentBalance || 0) - expectedBalance),
        description: `Creditor "${c.name}": currentBalance=${c.currentBalance} but should be outstanding_purchases(${payableByParty[c.name] || 0}) + opening(${c.openingBalance || 0}) = ${expectedBalance}`,
      })
      stats.creditors.flagged++
    }
  }

  // ---- 5. GL INTEGRITY: JournalEntry total debits == total credits ----
  const journalEntries = await db.journalEntry.findMany({
    where: { tenantId, isPosted: true },
    include: { lines: { select: { debit: true, credit: true } } },
  })
  stats.journalEntries = { total: journalEntries.length, checked: journalEntries.length, flagged: 0 }
  for (const je of journalEntries) {
    const totalDebits = roundTo2(je.lines.reduce((s, l) => s + (l.debit || 0), 0))
    const totalCredits = roundTo2(je.lines.reduce((s, l) => s + (l.credit || 0), 0))
    if (Math.abs(totalDebits - totalCredits) > TOLERANCE) {
      discrepancies.push({
        table: 'JournalEntry', id: je.id, field: 'balance',
        storedValue: totalDebits, computedValue: totalCredits,
        difference: roundTo2(totalDebits - totalCredits),
        description: `JE ${je.reference || je.id.slice(0, 8)}: debits=${totalDebits} ≠ credits=${totalCredits} (diff=${roundTo2(totalDebits - totalCredits)})`,
      })
      stats.journalEntries.flagged++
    }
  }

  // ---- 6. INVENTORY: value should = currentStock × purchasePrice ----
  const inventory = await db.inventoryItem.findMany({
    where: { tenantId, isDeleted: false },
    select: { id: true, name: true, currentStock: true, purchasePrice: true, value: true },
  })
  stats.inventory = { total: inventory.length, checked: inventory.length, flagged: 0 }
  for (const item of inventory) {
    const expectedValue = roundTo2((item.currentStock || 0) * (item.purchasePrice || 0))
    if (Math.abs((item.value || 0) - expectedValue) > TOLERANCE) {
      discrepancies.push({
        table: 'InventoryItem', id: item.id, field: 'value',
        storedValue: item.value || 0, computedValue: expectedValue,
        difference: roundTo2((item.value || 0) - expectedValue),
        description: `Item "${item.name}": value=${item.value} but should be stock(${item.currentStock}) × price(${item.purchasePrice}) = ${expectedValue}`,
      })
      stats.inventory.flagged++
    }
  }

  // ---- 7. ORPHANED JEs: sourceType=SALE/PURCHASE/EXPENSE but source record is soft-deleted ----
  const saleJEs = await db.journalEntry.findMany({
    where: { tenantId, sourceType: 'SALE', isPosted: true },
    select: { id: true, reference: true, sourceId: true },
  })
  stats.orphanedJEs = { total: saleJEs.length, checked: saleJEs.length, flagged: 0 }
  for (const je of saleJEs) {
    if (!je.sourceId) continue
    const sale = await db.sale.findUnique({ where: { id: je.sourceId }, select: { isDeleted: true, invoiceNumber: true } })
    if (sale?.isDeleted) {
      // Check if a reversal JE exists
      const reversal = await db.journalEntry.findFirst({
        where: { tenantId, sourceType: 'MANUAL', reference: { startsWith: `REVERSAL-${je.reference}` } },
      })
      if (!reversal) {
        discrepancies.push({
          table: 'JournalEntry', id: je.id, field: 'orphaned',
          storedValue: 0, computedValue: 0, difference: 0,
          description: `JE ${je.reference} references Sale ${sale.invoiceNumber} which is soft-deleted but no reversal JE exists`,
        })
        stats.orphanedJEs.flagged++
      }
    }
  }

  // ---- Summary ----
  const summary = {
    totalDiscrepancies: discrepancies.length,
    tablesAudited: Object.keys(stats).length,
    stats,
    generatedAt: new Date().toISOString(),
  }

  await writeAuditLog({
    tenantId, userId, userName,
    action: 'CREATE',
    entityType: 'Reconciliation',
    entityId: 'audit',
    entityName: `Database audit: ${discrepancies.length} discrepancies found`,
    changes: { summary },
  }).catch(() => {})

  return NextResponse.json({ success: true, summary, discrepancies })
}

// =====================================================================
// REMEDIATE — transaction-safe fix of all identified discrepancies
// =====================================================================
async function runRemediation(tenantId: string, userId: string, userName: string, dryRun: boolean) {
  // First run the audit to get the list of discrepancies
  const auditResult = await runAuditInternal(tenantId)
  const { discrepancies } = auditResult

  if (discrepancies.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No discrepancies found. Database is already in sync.',
      fixed: 0,
    })
  }

  if (dryRun) {
    return NextResponse.json({
      success: true,
      message: `DRY RUN: ${discrepancies.length} discrepancies would be fixed. Set dryRun=false to apply.`,
      wouldFix: discrepancies.length,
      discrepancies: discrepancies.slice(0, 20), // preview first 20
    })
  }

  // Group discrepancies by table for batch remediation
  const byTable: Record<string, Discrepancy[]> = {}
  for (const d of discrepancies) {
    if (!byTable[d.table]) byTable[d.table] = []
    byTable[d.table].push(d)
  }

  let fixed = 0
  const fixes: string[] = []

  // Fix Sales: recalculate totalAmount, amountPaid, paymentStatus
  if (byTable.Sale) {
    for (const d of byTable.Sale) {
      await db.$transaction(async (tx) => {
        const sale = await tx.sale.findUnique({ where: { id: d.id } })
        if (!sale) return
        const discountAmount = roundTo2((sale.subtotal || 0) * (sale.discountPercent || 0) / 100)
        const correctTotal = roundTo2((sale.subtotal || 0) - discountAmount + (sale.gstAmount || 0))
        const correctAmountPaid = sale.amountReceived || sale.amountPaid || 0
        const correctStatus = correctAmountPaid >= correctTotal && correctTotal > 0 ? 'RECEIVED' : correctAmountPaid > 0 ? 'PARTIAL' : 'PENDING'
        await tx.sale.update({
          where: { id: d.id },
          data: {
            totalAmount: correctTotal,
            amountPaid: correctAmountPaid,
            amountReceived: correctAmountPaid,
            paymentStatus: correctStatus,
          },
        })
        fixed++
        fixes.push(`Sale ${sale.invoiceNumber}: totalAmount=${correctTotal}, status=${correctStatus}`)
      })
    }
  }

  // Fix Purchases: recalculate totalAmount, paymentStatus
  if (byTable.Purchase) {
    for (const d of byTable.Purchase) {
      await db.$transaction(async (tx) => {
        const purchase = await tx.purchase.findUnique({ where: { id: d.id } })
        if (!purchase) return
        const correctTotal = roundTo2((purchase.subtotal || 0) + (purchase.gstAmount || 0))
        const paid = purchase.amountPaid || 0
        const correctStatus = paid >= correctTotal && correctTotal > 0 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID'
        await tx.purchase.update({
          where: { id: d.id },
          data: { totalAmount: correctTotal, paymentStatus: correctStatus },
        })
        fixed++
        fixes.push(`Purchase ${purchase.invoiceNumber}: totalAmount=${correctTotal}, status=${correctStatus}`)
      })
    }
  }

  // Fix Debtors: recalculate currentBalance from outstanding sales
  if (byTable.Debtor) {
    for (const d of byTable.Debtor) {
      await db.$transaction(async (tx) => {
        const debtor = await tx.debtor.findUnique({ where: { id: d.id } })
        if (!debtor) return
        const outstandingSales = await tx.sale.findMany({
          where: { tenantId, partyName: debtor.name, isDeleted: false, paymentStatus: { not: 'RECEIVED' } },
          select: { totalAmount: true, amountReceived: true, amountPaid: true },
        })
        const saleDerived = outstandingSales.reduce((sum, s) => {
          const due = (s.totalAmount || 0) - (s.amountReceived || s.amountPaid || 0)
          return sum + (due > 0 ? due : 0)
        }, 0)
        const correctBalance = roundTo2(saleDerived + (debtor.openingBalance || 0))
        await tx.debtor.update({ where: { id: d.id }, data: { currentBalance: correctBalance } })
        fixed++
        fixes.push(`Debtor "${debtor.name}": currentBalance=${correctBalance}`)
      })
    }
  }

  // Fix Creditors: recalculate currentBalance from outstanding purchases
  if (byTable.Creditor) {
    for (const d of byTable.Creditor) {
      await db.$transaction(async (tx) => {
        const creditor = await tx.creditor.findUnique({ where: { id: d.id } })
        if (!creditor) return
        const outstandingPurchases = await tx.purchase.findMany({
          where: { tenantId, partyName: creditor.name, isDeleted: false, paymentStatus: { not: 'PAID' } },
          select: { totalAmount: true, amountPaid: true },
        })
        const purchaseDerived = outstandingPurchases.reduce((sum, p) => {
          const due = (p.totalAmount || 0) - (p.amountPaid || 0)
          return sum + (due > 0 ? due : 0)
        }, 0)
        const correctBalance = roundTo2(purchaseDerived + (creditor.openingBalance || 0))
        await tx.creditor.update({ where: { id: d.id }, data: { currentBalance: correctBalance } })
        fixed++
        fixes.push(`Creditor "${creditor.name}": currentBalance=${correctBalance}`)
      })
    }
  }

  // Fix Inventory: recalculate value
  if (byTable.InventoryItem) {
    for (const d of byTable.InventoryItem) {
      await db.$transaction(async (tx) => {
        const item = await tx.inventoryItem.findUnique({ where: { id: d.id } })
        if (!item) return
        const correctValue = roundTo2((item.currentStock || 0) * (item.purchasePrice || 0))
        await tx.inventoryItem.update({ where: { id: d.id }, data: { value: correctValue } })
        fixed++
        fixes.push(`Inventory "${item.name}": value=${correctValue}`)
      })
    }
  }

  // Fix unbalanced Journal Entries: add an adjusting line to balance
  if (byTable.JournalEntry) {
    for (const d of byTable.JournalEntry) {
      await db.$transaction(async (tx) => {
        const je = await tx.journalEntry.findUnique({
          where: { id: d.id },
          include: { lines: true },
        })
        if (!je) return
        const totalDebits = roundTo2(je.lines.reduce((s, l) => s + (l.debit || 0), 0))
        const totalCredits = roundTo2(je.lines.reduce((s, l) => s + (l.credit || 0), 0))
        const diff = roundTo2(totalDebits - totalCredits)
        if (Math.abs(diff) <= TOLERANCE) return

        // Add an adjusting line to a rounding/clearing account
        // If debits > credits, credit the diff; if credits > debits, debit the diff
        let clearingAccount = await tx.account.findFirst({
          where: { accountCode: '59999', tenantId },
        })
        if (!clearingAccount) {
          clearingAccount = await tx.account.create({
            data: { accountCode: '59999', name: 'Rounding Adjustment', type: 'Expense', tenantId, isActive: true },
          })
        }
        await tx.journalEntryLine.create({
          data: {
            entryId: d.id,
            accountId: clearingAccount.id,
            debit: diff > 0 ? 0 : Math.abs(diff),
            credit: diff > 0 ? diff : 0,
            description: `Auto-adjustment to balance JE ${je.reference || d.id.slice(0, 8)}`,
          },
        })
        fixed++
        fixes.push(`JE ${je.reference || d.id.slice(0, 8)}: added adjusting line for ₹${Math.abs(diff)}`)
      })
    }
  }

  await writeAuditLog({
    tenantId, userId, userName,
    action: 'UPDATE',
    entityType: 'Reconciliation',
    entityId: 'remediate',
    entityName: `Database remediation: ${fixed} records fixed`,
    changes: { fixedCount: fixed, fixes: fixes.slice(0, 50) },
  }).catch(() => {})

  return NextResponse.json({
    success: true,
    message: `Remediation complete. ${fixed} records fixed across ${Object.keys(byTable).length} tables.`,
    fixed,
    fixes: fixes.slice(0, 50), // return first 50 fixes
  })
}

// Internal audit helper (used by remediate to avoid double-logging)
async function runAuditInternal(tenantId: string) {
  const discrepancies: Discrepancy[] = []

  // Sales
  const sales = await db.sale.findMany({
    where: { tenantId, isDeleted: false },
    select: { id: true, invoiceNumber: true, subtotal: true, gstAmount: true, totalAmount: true, discountPercent: true, amountReceived: true, amountPaid: true, paymentStatus: true },
  })
  for (const s of sales) {
    const discountAmount = roundTo2((s.subtotal || 0) * (s.discountPercent || 0) / 100)
    const expectedTotal = roundTo2((s.subtotal || 0) - discountAmount + (s.gstAmount || 0))
    if (Math.abs((s.totalAmount || 0) - expectedTotal) > TOLERANCE) {
      discrepancies.push({ table: 'Sale', id: s.id, field: 'totalAmount', storedValue: s.totalAmount || 0, computedValue: expectedTotal, difference: roundTo2((s.totalAmount || 0) - expectedTotal), description: `Sale ${s.invoiceNumber}: totalAmount mismatch` })
    }
    if (Math.abs((s.amountReceived || 0) - (s.amountPaid || 0)) > TOLERANCE) {
      discrepancies.push({ table: 'Sale', id: s.id, field: 'amountPaid', storedValue: s.amountPaid || 0, computedValue: s.amountReceived || 0, difference: roundTo2((s.amountPaid || 0) - (s.amountReceived || 0)), description: `Sale ${s.invoiceNumber}: amountPaid ≠ amountReceived` })
    }
    const received = s.amountReceived || s.amountPaid || 0
    const total = s.totalAmount || 0
    let expectedStatus = 'PENDING'
    if (received >= total && total > 0) expectedStatus = 'RECEIVED'
    else if (received > 0) expectedStatus = 'PARTIAL'
    const normalizedStatus = (s.paymentStatus === 'PAID' ? 'RECEIVED' : s.paymentStatus === 'UNPAID' ? 'PENDING' : s.paymentStatus)
    if (normalizedStatus !== expectedStatus && Math.abs(received - total) > TOLERANCE) {
      discrepancies.push({ table: 'Sale', id: s.id, field: 'paymentStatus', storedValue: 0, computedValue: 0, difference: 0, description: `Sale ${s.invoiceNumber}: status "${s.paymentStatus}" should be "${expectedStatus}"` })
    }
  }

  // Purchases
  const purchases = await db.purchase.findMany({
    where: { tenantId, isDeleted: false },
    select: { id: true, invoiceNumber: true, subtotal: true, gstAmount: true, totalAmount: true, amountPaid: true, paymentStatus: true },
  })
  for (const p of purchases) {
    const expectedTotal = roundTo2((p.subtotal || 0) + (p.gstAmount || 0))
    if (Math.abs((p.totalAmount || 0) - expectedTotal) > TOLERANCE) {
      discrepancies.push({ table: 'Purchase', id: p.id, field: 'totalAmount', storedValue: p.totalAmount || 0, computedValue: expectedTotal, difference: roundTo2((p.totalAmount || 0) - expectedTotal), description: `Purchase ${p.invoiceNumber}: totalAmount mismatch` })
    }
    const paid = p.amountPaid || 0
    const total = p.totalAmount || 0
    let expectedStatus = 'UNPAID'
    if (paid >= total && total > 0) expectedStatus = 'PAID'
    else if (paid > 0) expectedStatus = 'PARTIAL'
    if (p.paymentStatus !== expectedStatus && Math.abs(paid - total) > TOLERANCE) {
      discrepancies.push({ table: 'Purchase', id: p.id, field: 'paymentStatus', storedValue: 0, computedValue: 0, difference: 0, description: `Purchase ${p.invoiceNumber}: status "${p.paymentStatus}" should be "${expectedStatus}"` })
    }
  }

  // Debtors
  const debtors = await db.debtor.findMany({ where: { tenantId, isDeleted: false }, select: { id: true, name: true, openingBalance: true, currentBalance: true } })
  const outstandingSales = await db.sale.findMany({ where: { tenantId, isDeleted: false, paymentStatus: { not: 'RECEIVED' } }, select: { partyName: true, totalAmount: true, amountReceived: true, amountPaid: true } })
  const receivableByParty: Record<string, number> = {}
  for (const s of outstandingSales) {
    const due = (s.totalAmount || 0) - (s.amountReceived || s.amountPaid || 0)
    if (due > 0) receivableByParty[s.partyName] = (receivableByParty[s.partyName] || 0) + due
  }
  for (const d of debtors) {
    const expectedBalance = roundTo2((receivableByParty[d.name] || 0) + (d.openingBalance || 0))
    if (Math.abs((d.currentBalance || 0) - expectedBalance) > TOLERANCE) {
      discrepancies.push({ table: 'Debtor', id: d.id, field: 'currentBalance', storedValue: d.currentBalance || 0, computedValue: expectedBalance, difference: roundTo2((d.currentBalance || 0) - expectedBalance), description: `Debtor "${d.name}": currentBalance mismatch` })
    }
  }

  // Creditors
  const creditors = await db.creditor.findMany({ where: { tenantId, isDeleted: false }, select: { id: true, name: true, openingBalance: true, currentBalance: true } })
  const outstandingPurchases = await db.purchase.findMany({ where: { tenantId, isDeleted: false, paymentStatus: { not: 'PAID' } }, select: { partyName: true, totalAmount: true, amountPaid: true } })
  const payableByParty: Record<string, number> = {}
  for (const p of outstandingPurchases) {
    const due = (p.totalAmount || 0) - (p.amountPaid || 0)
    if (due > 0) payableByParty[p.partyName] = (payableByParty[p.partyName] || 0) + due
  }
  for (const c of creditors) {
    const expectedBalance = roundTo2((payableByParty[c.name] || 0) + (c.openingBalance || 0))
    if (Math.abs((c.currentBalance || 0) - expectedBalance) > TOLERANCE) {
      discrepancies.push({ table: 'Creditor', id: c.id, field: 'currentBalance', storedValue: c.currentBalance || 0, computedValue: expectedBalance, difference: roundTo2((c.currentBalance || 0) - expectedBalance), description: `Creditor "${c.name}": currentBalance mismatch` })
    }
  }

  // GL integrity
  const journalEntries = await db.journalEntry.findMany({ where: { tenantId, isPosted: true }, include: { lines: { select: { debit: true, credit: true } } } })
  for (const je of journalEntries) {
    const totalDebits = roundTo2(je.lines.reduce((s, l) => s + (l.debit || 0), 0))
    const totalCredits = roundTo2(je.lines.reduce((s, l) => s + (l.credit || 0), 0))
    if (Math.abs(totalDebits - totalCredits) > TOLERANCE) {
      discrepancies.push({ table: 'JournalEntry', id: je.id, field: 'balance', storedValue: totalDebits, computedValue: totalCredits, difference: roundTo2(totalDebits - totalCredits), description: `JE ${je.reference || je.id.slice(0, 8)}: debits ≠ credits` })
    }
  }

  // Inventory
  const inventory = await db.inventoryItem.findMany({ where: { tenantId, isDeleted: false }, select: { id: true, name: true, currentStock: true, purchasePrice: true, value: true } })
  for (const item of inventory) {
    const expectedValue = roundTo2((item.currentStock || 0) * (item.purchasePrice || 0))
    if (Math.abs((item.value || 0) - expectedValue) > TOLERANCE) {
      discrepancies.push({ table: 'InventoryItem', id: item.id, field: 'value', storedValue: item.value || 0, computedValue: expectedValue, difference: roundTo2((item.value || 0) - expectedValue), description: `Item "${item.name}": value mismatch` })
    }
  }

  return { discrepancies }
}
