import { NextRequest, NextResponse } from 'next/server'
import { db, rawDb } from '@/lib/db-soft-delete'
import { requireAuthAndTenant } from '@/lib/api-helpers'
import { roundTo2 } from '@/lib/gst-utils'

/**
 * TDS/TCS API — v4.86
 * ====================
 * Handles TDS (Tax Deducted at Source) and TCS (Tax Collected at Source)
 * entries with proper double-entry accounting.
 *
 * Accounting formula on TDS deduction:
 *   Dr Party (Creditor/Expense)   — full amount
 *   Cr Cash/Bank                  — amount - TDS
 *   Cr TDS Payable (20300)        — TDS amount
 *
 * When TDS is paid to government:
 *   Dr TDS Payable (20300)        — TDS amount
 *   Cr Cash/Bank                  — TDS amount
 *
 * Prisma schema needs a TDS model. For now, we store TDS entries as
 * JournalEntry with sourceType='TDS' and metadata in the description.
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    if (action === 'create') {
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      const data = body.data
      const sanitize = (v: unknown, fallback = 0): number => {
        const n = typeof v === 'number' ? v : Number(v)
        return Number.isFinite(n) ? n : fallback
      }

      const amount = roundTo2(sanitize(data.amount))
      const tdsRate = roundTo2(sanitize(data.tdsRate))
      const tdsAmount = roundTo2(sanitize(data.tdsAmount))
      const netAmount = roundTo2(amount - tdsAmount)

      if (amount <= 0) {
        return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 400 })
      }

      const result = await rawDb.$transaction(async (tx) => {
        // 1. Get or create accounts
        const accounts = await tx.account.findMany({ where: { tenantId: access.tenantId } })
        const findAccount = (code: string) => accounts.find(a => a.accountCode === code)

        let apAccount = findAccount('20100') // Accounts Payable (for the party)
        let cashAccount = findAccount('10100')
        let bankAccount = findAccount('10200')
        let tdsPayableAccount = findAccount('20300') // TDS Payable

        if (!apAccount) apAccount = await tx.account.create({ data: { accountCode: '20100', name: 'Accounts Payable', type: 'Liability', tenantId: access.tenantId } })
        if (!cashAccount) cashAccount = await tx.account.create({ data: { accountCode: '10100', name: 'Cash', type: 'Asset', tenantId: access.tenantId } })
        if (!bankAccount) bankAccount = await tx.account.create({ data: { accountCode: '10200', name: 'Bank Account', type: 'Asset', tenantId: access.tenantId } })
        if (!tdsPayableAccount) tdsPayableAccount = await tx.account.create({ data: { accountCode: '20300', name: 'TDS Payable', type: 'Liability', tenantId: access.tenantId } })

        // 2. Create journal entry
        // Dr Party (AP) — full amount
        // Cr Cash/Bank — net amount (amount - TDS)
        // Cr TDS Payable — TDS amount
        const paymentMode = (data.paymentMode || 'BANK').toUpperCase()
        const creditAccountId = paymentMode === 'CASH' ? cashAccount!.id : bankAccount!.id

        const je = await tx.journalEntry.create({
          data: {
            entryDate: new Date(data.date),
            reference: `TDS-${Date.now().toString().slice(-6)}`,
            description: `TDS u/s ${data.section}: ${data.partyName} - ${data.natureOfPayment || 'Payment'}`,
            sourceType: 'TDS',
            isPosted: true,
            tenantId: access.tenantId,
            createdBy: access.userId,
            lines: {
              create: [
                { accountId: apAccount!.id, debit: amount, credit: 0, description: `Payment to ${data.partyName} (Section ${data.section})` },
                { accountId: creditAccountId, debit: 0, credit: netAmount, description: `Net payment via ${paymentMode}` },
                { accountId: tdsPayableAccount!.id, debit: 0, credit: tdsAmount, description: `TDS deducted @ ${tdsRate}% u/s ${data.section}` },
              ],
            },
          },
          include: { lines: true },
        })

        // 3. Update Creditor balance (party now owes us the TDS, or we owe them less)
        const existingCreditor = await tx.creditor.findFirst({ where: { name: data.partyName, tenantId: access.tenantId, isDeleted: false } })
        if (existingCreditor) {
          await tx.creditor.update({
            where: { id: existingCreditor.id },
            data: { currentBalance: roundTo2(existingCreditor.currentBalance + amount) },
          })
        }

        // 4. Audit log
        await tx.auditLog.create({
          data: {
            tenantId: access.tenantId,
            userId: access.userId,
            userName: access.user.name,
            action: 'CREATE',
            entityType: 'TDS',
            entityId: je.id,
            entityName: `${data.partyName} - ${data.section}`,
            changes: JSON.stringify({
              partyName: data.partyName, section: data.section,
              amount, tdsRate, tdsAmount, netAmount,
              journalEntryId: je.id,
            }),
          },
        })

        // Return a TDS record shape for the frontend
        return {
          id: je.id,
          date: je.entryDate,
          partyName: data.partyName,
          partyPan: data.partyPan || null,
          section: data.section,
          natureOfPayment: data.natureOfPayment || '',
          amount,
          tdsRate,
          tdsAmount,
          status: 'DEDUCTED',
          challanNumber: null,
          notes: data.notes || null,
        }
      })

      return NextResponse.json({ record: result, journalEntryPosted: true })
    }

    if (action === 'list') {
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      const { startDate, endDate } = body
      const where: Record<string, unknown> = {
        tenantId: access.tenantId,
        isPosted: true,
        sourceType: 'TDS',
      }
      if (startDate && endDate) {
        where.entryDate = { gte: new Date(startDate), lt: new Date(endDate) }
      }

      const entries = await rawDb.journalEntry.findMany({
        where,
        include: { lines: { include: { account: true } } },
        orderBy: { entryDate: 'desc' },
      })

      // Transform journal entries to TDS record format
      const records = entries.map(je => {
        const apLine = je.lines.find(l => l.debit > 0)
        const tdsLine = je.lines.find(l => l.account?.accountCode === '20300')
        const cashLine = je.lines.find(l => l.credit > 0 && l.account?.accountCode !== '20300')

        // Parse description for party name and section
        const descMatch = je.description?.match(/TDS u\/s (\S+): (.+) -/)
        const section = descMatch ? descMatch[1].replace(':', '') : ''
        const partyName = descMatch ? descMatch[2] : ''

        return {
          id: je.id,
          date: je.entryDate,
          partyName,
          partyPan: null,
          section,
          natureOfPayment: '',
          amount: apLine?.debit || 0,
          tdsRate: tdsLine && apLine ? roundTo2((tdsLine.credit / apLine.debit) * 100) : 0,
          tdsAmount: tdsLine?.credit || 0,
          status: 'DEDUCTED',
          challanNumber: null,
          notes: je.description,
        }
      })

      return NextResponse.json({ records })
    }

    if (action === 'delete') {
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      const { id } = body

      await rawDb.$transaction(async (tx) => {
        // Find the original JE and reverse it
        const originalJE = await tx.journalEntry.findFirst({
          where: { id, tenantId: access.tenantId, sourceType: 'TDS' },
          include: { lines: true },
        })

        if (!originalJE) {
          throw new Error('TDS entry not found')
        }

        // Post reversing entry
        await tx.journalEntry.create({
          data: {
            entryDate: new Date(),
            reference: `REVERSAL-${originalJE.reference}`,
            description: `Reversal of TDS entry: ${originalJE.description}`,
            sourceType: 'MANUAL',
            isPosted: true,
            tenantId: access.tenantId,
            createdBy: access.userId,
            lines: {
              create: originalJE.lines.map(l => ({
                accountId: l.accountId,
                debit: l.credit,
                credit: l.debit,
                description: `Reversal: ${l.description || ''}`,
              })),
            },
          },
        })

        // Soft-delete the original JE
        await tx.journalEntry.update({
          where: { id },
          data: { isPosted: false },
        })

        await tx.auditLog.create({
          data: {
            tenantId: access.tenantId,
            userId: access.userId,
            userName: access.user.name,
            action: 'DELETE',
            entityType: 'TDS',
            entityId: id,
            entityName: originalJE.description || '',
            changes: JSON.stringify({ reason: 'User deletion' }),
          },
        })
      })

      return NextResponse.json({ success: true })
    }

    if (action === 'update') {
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      // For now, updates are handled by delete + create
      // A full update would reverse the old JE and post a new one
      return NextResponse.json({ error: 'Update via delete + create' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: any) {
    console.error('TDS error:', error)
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 })
  }
}
