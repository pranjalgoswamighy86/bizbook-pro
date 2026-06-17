import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    if (action === 'pnl') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { startDate, endDate } = body
      const dateFilter: Record<string, unknown> = { tenantId, isDeleted: false }
      if (startDate && endDate) {
        dateFilter.date = { gte: new Date(startDate), lt: new Date(endDate) }
      }

      const [sales, purchases, expenses, receipts, payments] = await Promise.all([
        db.sale.findMany({ where: dateFilter }),
        db.purchase.findMany({ where: dateFilter }),
        db.expense.findMany({ where: dateFilter }),
        db.receipt.findMany({ where: dateFilter }),
        db.payment.findMany({ where: dateFilter }),
      ])

      const totalRevenue = sales.reduce((s, x) => s + x.totalAmount, 0)
      const totalCostOfGoods = purchases.reduce((s, x) => s + x.subtotal, 0)
      const totalGstPaid = purchases.reduce((s, x) => s + x.gstAmount, 0)
      const totalGstCollected = sales.reduce((s, x) => s + x.gstAmount, 0)
      const totalExpenses = expenses.reduce((s, x) => s + x.amount, 0)
      const grossProfit = totalRevenue - totalCostOfGoods
      const netProfit = grossProfit - totalExpenses
      const totalReceipts = receipts.reduce((s, x) => s + x.amount, 0)
      const totalPayments = payments.reduce((s, x) => s + x.amount, 0)

      const expenseByCategory = expenses.reduce<Record<string, number>>((acc, e) => {
        acc[e.category] = (acc[e.category] || 0) + e.amount
        return acc
      }, {})

      return NextResponse.json({
        totalRevenue,
        totalCostOfGoods,
        grossProfit,
        totalExpenses,
        netProfit,
        totalGstCollected,
        totalGstPaid,
        netGst: totalGstCollected - totalGstPaid,
        totalReceipts,
        totalPayments,
        netCashFlow: totalReceipts - totalPayments,
        expenseByCategory,
        salesCount: sales.length,
        purchaseCount: purchases.length,
        expenseCount: expenses.length,
      })
    }

    if (action === 'day-report') {
      const { date } = body
      const start = new Date(date)
      const end = new Date(start.getTime() + 86400000)
      const dateFilter = { tenantId, isDeleted: false, date: { gte: start, lt: end } }

      const [sales, purchases, expenses, receipts, payments, bankTxns] = await Promise.all([
        db.sale.findMany({ where: dateFilter }),
        db.purchase.findMany({ where: dateFilter }),
        db.expense.findMany({ where: dateFilter }),
        db.receipt.findMany({ where: dateFilter }),
        db.payment.findMany({ where: dateFilter }),
        db.bankTransaction.findMany({ where: dateFilter }),
      ])

      const daySales = sales.reduce((s, x) => s + x.totalAmount, 0)
      const dayPurchases = purchases.reduce((s, x) => s + x.totalAmount, 0)
      const dayExpenses = expenses.reduce((s, x) => s + x.amount, 0)
      const dayReceipts = receipts.reduce((s, x) => s + x.amount, 0)
      const dayPayments = payments.reduce((s, x) => s + x.amount, 0)
      const dayBankIn = bankTxns.reduce((s, x) => s + x.deposit, 0)
      const dayBankOut = bankTxns.reduce((s, x) => s + x.withdrawal, 0)

      return NextResponse.json({
        date,
        sales: daySales,
        purchases: dayPurchases,
        expenses: dayExpenses,
        receipts: dayReceipts,
        payments: dayPayments,
        bankIn: dayBankIn,
        bankOut: dayBankOut,
        netCash: dayReceipts - dayPayments,
        salesList: sales,
        purchasesList: purchases,
        expensesList: expenses,
      })
    }

    if (action === 'balance-sheet') {
      const [inventory, debtors, creditors, bankBalance, allSales, allPurchases, allExpenses] = await Promise.all([
        db.inventoryItem.findMany({ where: { tenantId, isDeleted: false } }),
        db.debtor.findMany({ where: { tenantId, isDeleted: false } }),
        db.creditor.findMany({ where: { tenantId, isDeleted: false } }),
        db.bankTransaction.findMany({ where: { tenantId, isDeleted: false } }),
        db.sale.findMany({ where: { tenantId, isDeleted: false } }),
        db.purchase.findMany({ where: { tenantId, isDeleted: false } }),
        db.expense.findMany({ where: { tenantId, isDeleted: false } }),
      ])

      const totalInventoryValue = inventory.reduce((s, x) => s + x.value, 0)
      const totalDebtors = debtors.reduce((s, x) => s + x.currentBalance, 0) + allSales.reduce((s, x) => s + (x.totalAmount - x.amountPaid), 0)
      const totalCreditors = creditors.reduce((s, x) => s + x.currentBalance, 0) + allPurchases.reduce((s, x) => s + (x.totalAmount - x.amountPaid), 0)
      const lastBankBalance = bankBalance.length > 0 ? bankBalance[bankBalance.length - 1].balance : 0

      const totalRevenue = allSales.reduce((s, x) => s + x.totalAmount, 0)
      const totalCOGS = allPurchases.reduce((s, x) => s + x.subtotal, 0)
      const totalExpenseAmount = allExpenses.reduce((s, x) => s + x.amount, 0)
      const retainedEarnings = totalRevenue - totalCOGS - totalExpenseAmount

      const totalAssets = totalInventoryValue + totalDebtors + lastBankBalance
      const totalLiabilities = totalCreditors
      const equity = retainedEarnings

      return NextResponse.json({
        assets: { inventory: totalInventoryValue, debtors: totalDebtors, bankBalance: lastBankBalance, total: totalAssets },
        liabilities: { creditors: totalCreditors, total: totalLiabilities },
        equity: { retainedEarnings: equity, total: equity },
        totalAssetsLiabilities: totalAssets,
        totalLiabilitiesEquity: totalLiabilities + equity,
      })
    }

    if (action === 'dashboard') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { startDate, endDate } = body
      const dateFilter: Record<string, unknown> = { tenantId, isDeleted: false }
      if (startDate && endDate) {
        dateFilter.date = { gte: new Date(startDate), lt: new Date(endDate) }
      }

      const [salesStats, purchaseStats, expenseStats, inventory, debtors, creditors, bankTxns, receipts, payments] = await Promise.all([
        db.sale.findMany({ where: dateFilter }),
        db.purchase.findMany({ where: dateFilter }),
        db.expense.findMany({ where: dateFilter }),
        db.inventoryItem.findMany({ where: { tenantId, isDeleted: false } }),
        db.debtor.findMany({ where: { tenantId, isDeleted: false } }),
        db.creditor.findMany({ where: { tenantId, isDeleted: false } }),
        db.bankTransaction.findMany({ where: { tenantId, isDeleted: false }, orderBy: { date: 'desc' }, take: 5 }),
        db.receipt.findMany({ where: dateFilter }),
        db.payment.findMany({ where: dateFilter }),
      ])

      const totalSales = salesStats.reduce((s, x) => s + x.totalAmount, 0)
      const totalPurchases = purchaseStats.reduce((s, x) => s + x.totalAmount, 0)
      const totalExpenses = expenseStats.reduce((s, x) => s + x.amount, 0)
      const totalInventoryValue = inventory.reduce((s, x) => s + x.value, 0)
      const debtorBalances = debtors.reduce((s, x) => s + x.currentBalance, 0)
      const unpaidSales = salesStats.reduce((s, x) => s + (x.totalAmount - x.amountPaid), 0)
      const totalReceivable = debtorBalances + unpaidSales

      const creditorBalances = creditors.reduce((s, x) => s + x.currentBalance, 0)
      const unpaidPurchases = purchaseStats.reduce((s, x) => s + (x.totalAmount - x.amountPaid), 0)
      const totalPayable = creditorBalances + unpaidPurchases
      const totalReceipts = receipts.reduce((s, x) => s + x.amount, 0)
      const totalPayments = payments.reduce((s, x) => s + x.amount, 0)
      const lowStockCount = inventory.filter((i) => i.currentStock <= i.minStock).length

      // Monthly trend (last 6 months)
      const now = new Date()
      const monthlyTrend = []
      for (let i = 5; i >= 0; i--) {
        const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
        const monthFilter = { tenantId, isDeleted: false, date: { gte: monthStart, lt: monthEnd } }

        const [monthSales, monthPurchases, monthExpenses] = await Promise.all([
          db.sale.findMany({ where: monthFilter }),
          db.purchase.findMany({ where: monthFilter }),
          db.expense.findMany({ where: monthFilter }),
        ])

        monthlyTrend.push({
          month: monthStart.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
          sales: monthSales.reduce((s, x) => s + x.totalAmount, 0),
          purchases: monthPurchases.reduce((s, x) => s + x.totalAmount, 0),
          expenses: monthExpenses.reduce((s, x) => s + x.amount, 0),
        })
      }

      return NextResponse.json({
        totalSales,
        totalPurchases,
        totalExpenses,
        totalInventoryValue,
        totalReceivable,
        totalPayable,
        totalReceipts,
        totalPayments,
        netProfit: totalSales - totalPurchases - totalExpenses,
        lowStockCount,
        inventoryCount: inventory.length,
        recentBankTxns: bankTxns,
        monthlyTrend,
        salesCount: salesStats.length,
        purchaseCount: purchaseStats.length,
        expenseCount: expenseStats.length,
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Reports error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
