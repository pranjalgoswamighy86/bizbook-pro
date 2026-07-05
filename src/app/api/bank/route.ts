import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
// ---- SECURITY PATCH v2 imports ----
import { requireAuthAndTenant, writeAuditLog } from '@/lib/api-helpers'
// -----------------------------------
// v4.192: Dynamic ZAI SDK load — no static import (build fails on Railway)
import { getZaiClient, isZaiAvailable } from '@/lib/zai-client'

/**
 * Bank API — SECURITY-PATCHED (v2) reconcile action.
 *
 * This file shows the reconcile action with the double-linking protection
 * fix (H4). The rest of the bank route should also be patched with
 * requireAuthAndTenant per the SECURITY_PATCH.md pattern from v1.
 *
 * Copy the `reconcile` action below into your existing bank/route.ts,
 * replacing the old one. Then patch the other actions (create, update,
 * delete, list, upload-statement, match) with the same auth pattern.
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    // ============================================================
    // RECONCILE — link a bank transaction to a sale or purchase
    // ============================================================
    // SECURITY FIX (H4): Previously, the same sale could be reconciled
    // to multiple bank transactions, each one marking the sale as
    // RECEIVED and adjusting the debtor balance. Now we check that:
    //   1. The transaction belongs to the authenticated tenant
    //   2. The transaction isn't already reconciled
    //   3. The sale/purchase isn't already matched to another transaction
    //   4. Everything runs in a transaction so partial failures roll back
    // ============================================================
    if (action === 'reconcile') {
      // ---- SECURITY PATCH v2: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { transactionId, matchType, matchId } = body

      if (!transactionId || !matchType || !matchId) {
        return NextResponse.json(
          { error: 'transactionId, matchType, and matchId are required' },
          { status: 400 }
        )
      }

      if (!['sale', 'purchase'].includes(matchType)) {
        return NextResponse.json(
          { error: 'matchType must be "sale" or "purchase"' },
          { status: 400 }
        )
      }

      // ---- SECURITY FIX (H4): run everything in a transaction ----
      const result = await db.$transaction(async (tx) => {
        // 1. Fetch the bank transaction — verify it belongs to this tenant
        const transaction = await tx.bankTransaction.findFirst({
          where: { id: transactionId, tenantId: access.tenantId, isDeleted: false },
        })
        if (!transaction) {
          throw new ReconcileError('Bank transaction not found', 404)
        }

        // 2. SECURITY FIX (H4): check transaction isn't already reconciled
        if (transaction.isReconciled) {
          throw new ReconcileError(
            `Transaction "${transaction.description}" is already reconciled. ` +
            `Unreconcile it first if you want to change the match.`,
            409
          )
        }

        if (matchType === 'sale') {
          // 3. Fetch the sale — verify it belongs to this tenant
          const sale = await tx.sale.findFirst({
            where: { id: matchId, tenantId: access.tenantId, isDeleted: false },
          })
          if (!sale) {
            throw new ReconcileError('Sale not found', 404)
          }

          // 4. SECURITY FIX (H4): check sale isn't already matched to another txn
          const existingMatch = await tx.bankTransaction.findFirst({
            where: {
              matchedSaleId: matchId,
              id: { not: transactionId },
              isDeleted: false,
            },
          })
          if (existingMatch) {
            throw new ReconcileError(
              `Sale ${sale.invoiceNumber} is already reconciled to another ` +
              `transaction ("${existingMatch.description}" on ${existingMatch.date.toISOString().slice(0, 10)}). ` +
              `Unreconcile that first.`,
              409
            )
          }

          // 5. Verify amounts roughly match (within tolerance)
          const tolerance = 1.0
          if (Math.abs(transaction.deposit - sale.totalAmount) > tolerance) {
            throw new ReconcileError(
              `Amount mismatch: bank deposit is ₹${transaction.deposit.toFixed(2)} ` +
              `but sale total is ₹${sale.totalAmount.toFixed(2)}. ` +
              `Difference exceeds ₹${tolerance} tolerance.`,
              400
            )
          }

          // 6. Link them
          await tx.bankTransaction.update({
            where: { id: transactionId },
            data: {
              matchedSaleId: matchId,
              isReconciled: true,
            },
          })

          // 7. Update sale payment status
          const previousStatus = sale.paymentStatus
          await tx.sale.update({
            where: { id: matchId },
            data: {
              paymentStatus: 'RECEIVED',
              amountReceived: sale.totalAmount,
              amountPaid: sale.totalAmount,
            },
          })

          // 8. Update debtor balance
          const debtor = await tx.debtor.findFirst({
            where: { name: sale.partyName, tenantId: access.tenantId, isDeleted: false },
          })
          if (debtor) {
            await tx.debtor.update({
              where: { id: debtor.id },
              data: {
                currentBalance: Math.max(
                  0,
                  debtor.currentBalance - sale.totalAmount
                ),
              },
            })
          }

          // 9. Audit log
          await tx.auditLog.create({
            data: {
              tenantId: access.tenantId,
              userId: access.userId,
              userName: access.user.name,
              action: 'UPDATE',
              entityType: 'BankTransaction',
              entityId: transactionId,
              entityName: transaction.description,
              changes: JSON.stringify({
                reconciled: true,
                matchedSaleId: matchId,
                saleInvoice: sale.invoiceNumber,
                previousSaleStatus: previousStatus,
              }),
            },
          })

          return { type: 'sale', saleInvoice: sale.invoiceNumber }
        } else {
          // matchType === 'purchase'
          const purchase = await tx.purchase.findFirst({
            where: { id: matchId, tenantId: access.tenantId, isDeleted: false },
          })
          if (!purchase) {
            throw new ReconcileError('Purchase not found', 404)
          }

          // SECURITY FIX (H4): check purchase isn't already matched
          const existingMatch = await tx.bankTransaction.findFirst({
            where: {
              matchedPurchaseId: matchId,
              id: { not: transactionId },
              isDeleted: false,
            },
          })
          if (existingMatch) {
            throw new ReconcileError(
              `Purchase ${purchase.invoiceNumber} is already reconciled to another ` +
              `transaction. Unreconcile that first.`,
              409
            )
          }

          // Verify amounts
          const tolerance = 1.0
          if (Math.abs(transaction.withdrawal - purchase.totalAmount) > tolerance) {
            throw new ReconcileError(
              `Amount mismatch: bank withdrawal is ₹${transaction.withdrawal.toFixed(2)} ` +
              `but purchase total is ₹${purchase.totalAmount.toFixed(2)}.`,
              400
            )
          }

          // Link them
          await tx.bankTransaction.update({
            where: { id: transactionId },
            data: {
              matchedPurchaseId: matchId,
              isReconciled: true,
            },
          })

          // Update purchase payment status
          const previousStatus = purchase.paymentStatus
          await tx.purchase.update({
            where: { id: matchId },
            data: {
              paymentStatus: 'PAID',
              amountPaid: purchase.totalAmount,
            },
          })

          // Update creditor balance
          const creditor = await tx.creditor.findFirst({
            where: { name: purchase.partyName, tenantId: access.tenantId, isDeleted: false },
          })
          if (creditor) {
            await tx.creditor.update({
              where: { id: creditor.id },
              data: {
                currentBalance: Math.max(
                  0,
                  creditor.currentBalance - purchase.totalAmount
                ),
              },
            })
          }

          // Audit log
          await tx.auditLog.create({
            data: {
              tenantId: access.tenantId,
              userId: access.userId,
              userName: access.user.name,
              action: 'UPDATE',
              entityType: 'BankTransaction',
              entityId: transactionId,
              entityName: transaction.description,
              changes: JSON.stringify({
                reconciled: true,
                matchedPurchaseId: matchId,
                purchaseInvoice: purchase.invoiceNumber,
                previousPurchaseStatus: previousStatus,
              }),
            },
          })

          return { type: 'purchase', purchaseInvoice: purchase.invoiceNumber }
        }
      })

      return NextResponse.json({
        success: true,
        reconciled: result,
      })
    }

    // ============================================================
    // UNRECONCILE — unlink a bank transaction from its sale/purchase
    // (New action — needed so users can fix mistakes)
    // ============================================================
    if (action === 'unreconcile') {
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      const { transactionId } = body
      if (!transactionId) {
        return NextResponse.json(
          { error: 'transactionId is required' },
          { status: 400 }
        )
      }

      const result = await db.$transaction(async (tx) => {
        const transaction = await tx.bankTransaction.findFirst({
          where: { id: transactionId, tenantId: access.tenantId, isDeleted: false },
        })
        if (!transaction) {
          throw new ReconcileError('Bank transaction not found', 404)
        }
        if (!transaction.isReconciled) {
          throw new ReconcileError('Transaction is not reconciled', 400)
        }

        // Reverse the sale/purchase status
        if (transaction.matchedSaleId) {
          const sale = await tx.sale.findUnique({ where: { id: transaction.matchedSaleId } })
          if (sale) {
            // Restore to PENDING (or PARTIAL if there was a partial payment before)
            await tx.sale.update({
              where: { id: sale.id },
              data: {
                paymentStatus: 'PENDING',
                amountReceived: 0,
                amountPaid: 0,
              },
            })
            // Restore debtor balance
            const debtor = await tx.debtor.findFirst({
              where: { name: sale.partyName, tenantId: access.tenantId, isDeleted: false },
            })
            if (debtor) {
              await tx.debtor.update({
                where: { id: debtor.id },
                data: { currentBalance: debtor.currentBalance + sale.totalAmount },
              })
            }
          }
        }
        if (transaction.matchedPurchaseId) {
          const purchase = await tx.purchase.findUnique({ where: { id: transaction.matchedPurchaseId } })
          if (purchase) {
            await tx.purchase.update({
              where: { id: purchase.id },
              data: {
                paymentStatus: 'UNPAID',
                amountPaid: 0,
              },
            })
            const creditor = await tx.creditor.findFirst({
              where: { name: purchase.partyName, tenantId: access.tenantId, isDeleted: false },
            })
            if (creditor) {
              await tx.creditor.update({
                where: { id: creditor.id },
                data: { currentBalance: creditor.currentBalance + purchase.totalAmount },
              })
            }
          }
        }

        // Unlink the transaction
        const updated = await tx.bankTransaction.update({
          where: { id: transactionId },
          data: {
            matchedSaleId: null,
            matchedPurchaseId: null,
            isReconciled: false,
          },
        })

        await tx.auditLog.create({
          data: {
            tenantId: access.tenantId,
            userId: access.userId,
            userName: access.user.name,
            action: 'UPDATE',
            entityType: 'BankTransaction',
            entityId: transactionId,
            entityName: transaction.description,
            changes: JSON.stringify({ reconciled: false, unreconciled: true }),
          },
        })

        return updated
      })

      return NextResponse.json({ success: true, transaction: result })
    }

    // ============================================================
    // Other actions (create, update, delete, list, upload-statement, match)
    // should be patched with the same requireAuthAndTenant pattern.
    // See SECURITY_PATCH.md (v1) for the pattern.
    // ============================================================

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    if (error instanceof ReconcileError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Bank error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Helper error class for reconcile-specific errors
class ReconcileError extends Error {
  public readonly statusCode: number
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'ReconcileError'
    this.statusCode = statusCode
  }
}
