import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'
import { roundTo2 } from '@/lib/gst-utils'

// =====================================================================
// v6.28.0: Receipts → General Ledger auto-posting + Debtor/Sale linkage
// =====================================================================
// Previously, creating a receipt did NOTHING except insert a row in the
// Receipt table. It did not:
//   - Post a Journal Entry (Dr Cash/Bank / Cr Accounts Receivable)
//   - Reduce Debtor.currentBalance
//   - Increase Sale.amountReceived / Sale.amountPaid
//   - Flip Sale.paymentStatus to RECEIVED when fully paid
//
// This meant the dashboard "Receivables" card stayed at the original
// invoice value forever, even after the customer paid. The GL also had
// no record of the receipt, so Trial Balance drifted from reality.
//
// Now every receipt CREATE posts a JE and links back to the debtor/sale:
//
//   CREATE:  Dr Cash (10100) OR Bank (10200)   amount   (based on paymentMode)
//            Cr Accounts Receivable (10300)    amount
//
//            + Reduce Debtor.currentBalance for partyName by amount
//            + If invoiceRef matches a sale, increase Sale.amountReceived
//              and flip paymentStatus to RECEIVED if fully paid
//
//   UPDATE:  Reverse original JE + post new JE with new amounts
//
//   DELETE:  Reverse original JE
// =====================================================================

function paymentModeToDebitAccountCode(paymentMode: string | undefined): string {
  const m = (paymentMode || '').toUpperCase()
  if (m === 'BANK' || m === 'CHEQUE' || m === 'NEFT' || m === 'RTGS' || m === 'UPI') return '10200'
  return '10100' // Cash
}

async function ensureAccount(tx: any, tenantId: string, code: string, name: string, type: string) {
  let acc = await tx.account.findFirst({ where: { accountCode: code, tenantId } })
  if (!acc) {
    acc = await tx.account.create({ data: { accountCode: code, name, type, tenantId, isActive: true } })
  }
  return acc
}

// Post a Journal Entry for a receipt. Used by create + update.
async function postReceiptJE(
  tx: any,
  tenantId: string,
  userId: string | null,
  receipt: any,
  amount: number,
  paymentMode: string | undefined,
  receiptDate: Date,
  reversal = false,
) {
  const debitAccCode = paymentModeToDebitAccountCode(paymentMode)
  const debitAccount = await ensureAccount(tx, tenantId, debitAccCode, debitAccCode === '10100' ? 'Cash' : 'Bank Account', 'Asset')
  const arAccount = await ensureAccount(tx, tenantId, '10300', 'Accounts Receivable', 'Asset')

  const ref = `${reversal ? 'REVERSAL-' : ''}RCT/${receipt.id.slice(0, 8)}`

  if (!reversal) {
    await tx.journalEntry.create({
      data: {
        entryDate: receiptDate,
        reference: ref,
        description: `Receipt from ${receipt.partyName}${receipt.invoiceRef ? ` for ${receipt.invoiceRef}` : ''}`,
        sourceType: 'RECEIPT',
        sourceId: receipt.id,
        isPosted: true,
        tenantId,
        createdBy: userId,
        lines: {
          create: [
            { accountId: debitAccount.id, debit: amount, credit: 0, description: `Received via ${paymentMode || 'CASH'}` },
            { accountId: arAccount.id, debit: 0, credit: amount, description: `Against receivable from ${receipt.partyName}` },
          ],
        },
      },
    })
  } else {
    await tx.journalEntry.create({
      data: {
        entryDate: new Date(),
        reference: ref,
        description: `Reversal of receipt from ${receipt.partyName}`,
        sourceType: 'MANUAL',
        isPosted: true,
        tenantId,
        createdBy: userId,
        lines: {
          create: [
            { accountId: debitAccount.id, debit: 0, credit: amount, description: `Reversal: Received via ${paymentMode || 'CASH'}` },
            { accountId: arAccount.id, debit: amount, credit: 0, description: `Reversal: Against receivable from ${receipt.partyName}` },
          ],
        },
      },
    })
  }
}

// Find and reverse the original auto-posted JE for a receipt.
async function reverseOriginalReceiptJE(tx: any, tenantId: string, userId: string | null, receiptId: string) {
  const originalJE = await tx.journalEntry.findFirst({
    where: { sourceType: 'RECEIPT', sourceId: receiptId, tenantId },
    include: { lines: true },
  })
  if (originalJE) {
    await tx.journalEntry.create({
      data: {
        entryDate: new Date(),
        reference: `REVERSAL-${originalJE.reference || receiptId.slice(0, 8)}`,
        description: `Reversal of receipt (edited or deleted)`,
        sourceType: 'MANUAL',
        isPosted: true,
        tenantId,
        createdBy: userId,
        lines: {
          create: originalJE.lines.map((l: any) => ({
            accountId: l.accountId,
            debit: l.credit,
            credit: l.debit,
            description: `Reversal: ${l.description || ''}`,
          })),
        },
      },
    })
  }
}

// Reduce Debtor.currentBalance and update the linked Sale if invoiceRef matches.
async function applyReceiptToDebtorAndSale(
  tx: any,
  tenantId: string,
  partyName: string,
  amount: number,
  invoiceRef: string | null | undefined,
  isReversal = false,
) {
  // Update Debtor
  const debtor = await tx.debtor.findFirst({ where: { name: partyName, tenantId, isDeleted: false } })
  if (debtor) {
    const delta = isReversal ? amount : -amount
    await tx.debtor.update({
      where: { id: debtor.id },
      data: { currentBalance: roundTo2(Math.max(0, debtor.currentBalance + delta)) },
    })
  }

  // Update Party
  const party = await tx.party.findFirst({ where: { name: partyName, tenantId, isDeleted: false } })
  if (party) {
    const delta = isReversal ? amount : -amount
    await tx.party.update({
      where: { id: party.id },
      data: { currentBalance: roundTo2(party.currentBalance + delta) },
    })
  }

  // Update Sale if invoiceRef matches
  if (invoiceRef) {
    const sale = await tx.sale.findFirst({ where: { invoiceNumber: invoiceRef, tenantId, isDeleted: false } })
    if (sale) {
      const delta = isReversal ? -amount : amount
      const newAmountReceived = roundTo2(Math.max(0, (sale.amountReceived || 0) + delta))
      const newAmountPaid = roundTo2(Math.max(0, (sale.amountPaid || 0) + delta))
      const newStatus = newAmountReceived >= sale.totalAmount ? 'RECEIVED' : (newAmountReceived > 0 ? 'PARTIAL' : 'PENDING')
      await tx.sale.update({
        where: { id: sale.id },
        data: { amountReceived: newAmountReceived, amountPaid: newAmountPaid, paymentStatus: newStatus },
      })
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    if (action === 'create') {
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      // v6.28.0: Wrap receipt create + JE + debtor/sale update in a transaction
      const receipt = await db.$transaction(async (tx) => {
        const created = await tx.receipt.create({ data: { ...body.data, tenantId: access.tenantId } })
        // Post JE: Dr Cash/Bank / Cr Accounts Receivable
        await postReceiptJE(tx, access.tenantId, access.userId, created, created.amount, created.paymentMode, created.date, false)
        // Reduce Debtor.currentBalance + update Sale if invoiceRef matches
        await applyReceiptToDebtorAndSale(tx, access.tenantId, created.partyName, created.amount, created.invoiceRef, false)
        return created
      })
      return NextResponse.json({ receipt })
    }

    if (action === 'update') {
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      const { id, data } = body
      // v6.28.0: verify ownership + fetch original for reversal math
      const existing = await db.receipt.findFirst({ where: { id, tenantId: access.tenantId } })
      if (!existing) {
        return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
      }

      const receipt = await db.$transaction(async (tx) => {
        const updated = await tx.receipt.update({ where: { id }, data })
        // Reverse the original JE
        await reverseOriginalReceiptJE(tx, access.tenantId, access.userId, id)
        // Reverse the debtor/sale impact of the OLD receipt
        await applyReceiptToDebtorAndSale(tx, access.tenantId, existing.partyName, existing.amount, existing.invoiceRef, true)
        // Post a new JE with the updated values
        await postReceiptJE(tx, access.tenantId, access.userId, updated, updated.amount, updated.paymentMode, updated.date, false)
        // Apply the NEW receipt's impact to debtor/sale
        await applyReceiptToDebtorAndSale(tx, access.tenantId, updated.partyName, updated.amount, updated.invoiceRef, false)
        return updated
      })
      return NextResponse.json({ receipt })
    }

    if (action === 'delete') {
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      const { id } = body
      const existing = await db.receipt.findFirst({ where: { id, tenantId: access.tenantId } })
      if (!existing) {
        return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
      }

      await db.$transaction(async (tx) => {
        // Reverse the original JE
        await reverseOriginalReceiptJE(tx, access.tenantId, access.userId, id)
        // Reverse the debtor/sale impact
        await applyReceiptToDebtorAndSale(tx, access.tenantId, existing.partyName, existing.amount, existing.invoiceRef, true)
        // Soft-delete
        await tx.receipt.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } })
      })
      return NextResponse.json({ success: true })
    }

    if (action === 'list') {
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      const { startDate, endDate, search } = body
      const where: Record<string, unknown> = { tenantId, isDeleted: false }
      if (startDate && endDate) {
        where.date = { gte: new Date(startDate), lt: new Date(endDate) }
      }
      if (search) {
        where.OR = [
          { partyName: { contains: search } },
          { purpose: { contains: search } },
          { reference: { contains: search } },
        ]
      }
      const page = Number(body.page) || 1
      const limit = Math.min(Number(body.limit) || 100, 500)
      const skip = (page - 1) * limit
      const receipts = await db.receipt.findMany({ where, orderBy: { date: 'desc' }, take: limit, skip })
      const totalReceipts = receipts.reduce((sum, r) => sum + r.amount, 0)
      const totalCount = await db.receipt.count({ where })
      return NextResponse.json({ receipts, totalReceipts, page, limit, hasMore: skip + receipts.length < totalCount })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Receipts error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
