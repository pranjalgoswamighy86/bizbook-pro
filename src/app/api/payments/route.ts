import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'
import { roundTo2 } from '@/lib/gst-utils'

// =====================================================================
// v6.28.0: Payments → General Ledger auto-posting + Creditor/Purchase linkage
// =====================================================================
// Previously, creating a payment did NOTHING except insert a row in the
// Payment table. It did not:
//   - Post a Journal Entry (Dr Accounts Payable / Cr Cash/Bank)
//   - Reduce Creditor.currentBalance
//   - Increase Purchase.amountPaid
//   - Flip Purchase.paymentStatus to PAID when fully paid
//
// This meant the dashboard "Payables" card stayed at the original invoice
// value forever, even after the supplier was paid. The GL also had no
// record of the payment, so Trial Balance drifted from reality.
//
// Now every payment CREATE posts a JE and links back to the creditor/purchase:
//
//   CREATE:  Dr Accounts Payable (20100)        amount
//            Cr Cash (10100) OR Bank (10200)    amount   (based on paymentMode)
//
//            + Reduce Creditor.currentBalance for partyName by amount
//            + If invoiceRef matches a purchase, increase Purchase.amountPaid
//              and flip paymentStatus to PAID if fully paid
//
//   UPDATE:  Reverse original JE + post new JE with new amounts
//
//   DELETE:  Reverse original JE
// =====================================================================

function paymentModeToCreditAccountCode(paymentMode: string | undefined): string {
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

async function postPaymentJE(
  tx: any,
  tenantId: string,
  userId: string | null,
  payment: any,
  amount: number,
  paymentMode: string | undefined,
  paymentDate: Date,
  reversal = false,
) {
  const creditAccCode = paymentModeToCreditAccountCode(paymentMode)
  const creditAccount = await ensureAccount(tx, tenantId, creditAccCode, creditAccCode === '10100' ? 'Cash' : 'Bank Account', 'Asset')
  const apAccount = await ensureAccount(tx, tenantId, '20100', 'Accounts Payable', 'Liability')

  const ref = `${reversal ? 'REVERSAL-' : ''}PMT/${payment.id.slice(0, 8)}`

  if (!reversal) {
    await tx.journalEntry.create({
      data: {
        entryDate: paymentDate,
        reference: ref,
        description: `Payment to ${payment.partyName}${payment.invoiceRef ? ` for ${payment.invoiceRef}` : ''}`,
        sourceType: 'PAYMENT',
        sourceId: payment.id,
        isPosted: true,
        tenantId,
        createdBy: userId,
        lines: {
          create: [
            { accountId: apAccount.id, debit: amount, credit: 0, description: `Against payable to ${payment.partyName}` },
            { accountId: creditAccount.id, debit: 0, credit: amount, description: `Paid via ${paymentMode || 'CASH'}` },
          ],
        },
      },
    })
  } else {
    await tx.journalEntry.create({
      data: {
        entryDate: new Date(),
        reference: ref,
        description: `Reversal of payment to ${payment.partyName}`,
        sourceType: 'MANUAL',
        isPosted: true,
        tenantId,
        createdBy: userId,
        lines: {
          create: [
            { accountId: apAccount.id, debit: 0, credit: amount, description: `Reversal: Against payable to ${payment.partyName}` },
            { accountId: creditAccount.id, debit: amount, credit: 0, description: `Reversal: Paid via ${paymentMode || 'CASH'}` },
          ],
        },
      },
    })
  }
}

async function reverseOriginalPaymentJE(tx: any, tenantId: string, userId: string | null, paymentId: string) {
  const originalJE = await tx.journalEntry.findFirst({
    where: { sourceType: 'PAYMENT', sourceId: paymentId, tenantId },
    include: { lines: true },
  })
  if (originalJE) {
    await tx.journalEntry.create({
      data: {
        entryDate: new Date(),
        reference: `REVERSAL-${originalJE.reference || paymentId.slice(0, 8)}`,
        description: `Reversal of payment (edited or deleted)`,
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

async function applyPaymentToCreditorAndPurchase(
  tx: any,
  tenantId: string,
  partyName: string,
  amount: number,
  invoiceRef: string | null | undefined,
  isReversal = false,
) {
  // Update Creditor
  const creditor = await tx.creditor.findFirst({ where: { name: partyName, tenantId, isDeleted: false } })
  if (creditor) {
    const delta = isReversal ? amount : -amount
    await tx.creditor.update({
      where: { id: creditor.id },
      data: { currentBalance: roundTo2(Math.max(0, creditor.currentBalance + delta)) },
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

  // Update Purchase if invoiceRef matches
  if (invoiceRef) {
    const purchase = await tx.purchase.findFirst({ where: { invoiceNumber: invoiceRef, tenantId, isDeleted: false } })
    if (purchase) {
      const delta = isReversal ? -amount : amount
      const newAmountPaid = roundTo2(Math.max(0, (purchase.amountPaid || 0) + delta))
      const newStatus = newAmountPaid >= purchase.totalAmount ? 'PAID' : (newAmountPaid > 0 ? 'PARTIAL' : 'UNPAID')
      await tx.purchase.update({
        where: { id: purchase.id },
        data: { amountPaid: newAmountPaid, paymentStatus: newStatus },
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

      // v6.28.0: Wrap payment create + JE + creditor/purchase update in a transaction
      const payment = await db.$transaction(async (tx) => {
        const created = await tx.payment.create({ data: { ...body.data, tenantId: access.tenantId } })
        await postPaymentJE(tx, access.tenantId, access.userId, created, created.amount, created.paymentMode, created.date, false)
        await applyPaymentToCreditorAndPurchase(tx, access.tenantId, created.partyName, created.amount, created.invoiceRef, false)
        return created
      })
      return NextResponse.json({ payment })
    }

    if (action === 'update') {
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      const { id, data } = body
      const existing = await db.payment.findFirst({ where: { id, tenantId: access.tenantId } })
      if (!existing) {
        return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
      }

      const payment = await db.$transaction(async (tx) => {
        const updated = await tx.payment.update({ where: { id }, data })
        await reverseOriginalPaymentJE(tx, access.tenantId, access.userId, id)
        await applyPaymentToCreditorAndPurchase(tx, access.tenantId, existing.partyName, existing.amount, existing.invoiceRef, true)
        await postPaymentJE(tx, access.tenantId, access.userId, updated, updated.amount, updated.paymentMode, updated.date, false)
        await applyPaymentToCreditorAndPurchase(tx, access.tenantId, updated.partyName, updated.amount, updated.invoiceRef, false)
        return updated
      })
      return NextResponse.json({ payment })
    }

    if (action === 'delete') {
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      const { id } = body
      const existing = await db.payment.findFirst({ where: { id, tenantId: access.tenantId } })
      if (!existing) {
        return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
      }

      await db.$transaction(async (tx) => {
        await reverseOriginalPaymentJE(tx, access.tenantId, access.userId, id)
        await applyPaymentToCreditorAndPurchase(tx, access.tenantId, existing.partyName, existing.amount, existing.invoiceRef, true)
        await tx.payment.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } })
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
      const payments = await db.payment.findMany({ where, orderBy: { date: 'desc' } })
      const totalPayments = payments.reduce((sum, p) => sum + p.amount, 0)
      return NextResponse.json({ payments, totalPayments })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Payments error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
