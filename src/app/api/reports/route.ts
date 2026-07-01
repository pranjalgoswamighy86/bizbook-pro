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

      // v4.159: SalaryPayment has 'paidDate' not 'date' — separate filter
      const salaryDateFilter: Record<string, unknown> = { tenantId, isDeleted: false }
      if (startDate && endDate) {
        salaryDateFilter.paidDate = { gte: new Date(startDate), lt: new Date(endDate) }
      }

      // v4.59: Use select to only fetch needed fields (was loading entire records)
      // This reduces DB response size by 80-90% for large tables
      const [sales, purchases, expenses, receipts, payments] = await Promise.all([
        db.sale.findMany({ where: dateFilter, select: { totalAmount: true, subtotal: true, gstAmount: true, date: true, partyName: true } }),
        db.purchase.findMany({ where: dateFilter, select: { subtotal: true, gstAmount: true, date: true, partyName: true } }),
        db.expense.findMany({ where: dateFilter, select: { amount: true, category: true, date: true, description: true, paymentMode: true } }),
        db.receipt.findMany({ where: dateFilter, select: { amount: true, date: true, partyName: true, paymentMode: true } }),
        db.payment.findMany({ where: dateFilter, select: { amount: true, date: true, partyName: true, paymentMode: true } }),
      ])

      // v4.59: Use aggregate for totals (DB-side computation, no data transfer)
      // Was: findMany → load all records → reduce in JS → much slower for large datasets
      const [salesAgg, purchasesAgg, expensesAgg, receiptsAgg, paymentsAgg, salaryAgg] = await Promise.all([
        db.sale.aggregate({ where: dateFilter, _sum: { totalAmount: true, subtotal: true, gstAmount: true }, _count: true }),
        db.purchase.aggregate({ where: dateFilter, _sum: { subtotal: true, gstAmount: true }, _count: true }),
        db.expense.aggregate({ where: dateFilter, _sum: { amount: true }, _count: true }),
        db.receipt.aggregate({ where: dateFilter, _sum: { amount: true }, _count: true }),
        db.payment.aggregate({ where: dateFilter, _sum: { amount: true }, _count: true }),
        // v4.159: Include salary payments in P&L (was missing — net profit was overstated)
        db.salaryPayment.aggregate({ where: salaryDateFilter, _sum: { amount: true }, _count: true }),
      ])

      const totalRevenue = salesAgg._sum.totalAmount || 0
      const totalCostOfGoods = purchasesAgg._sum.subtotal || 0
      const totalGstPaid = purchasesAgg._sum.gstAmount || 0
      const totalGstCollected = salesAgg._sum.gstAmount || 0
      const totalExpenses = expensesAgg._sum.amount || 0
      const totalSalaries = salaryAgg._sum.amount || 0  // v4.159
      const grossProfit = totalRevenue - totalCostOfGoods
      const netProfit = grossProfit - totalExpenses - totalSalaries  // v4.159: subtract salaries
      const totalReceipts = receiptsAgg._sum.amount || 0
      const totalPayments = paymentsAgg._sum.amount || 0
      const salesCount = salesAgg._count || 0
      const purchaseCount = purchasesAgg._count || 0
      const expenseCount = expensesAgg._count || 0
      const salaryCount = salaryAgg._count || 0  // v4.159

      // v4.59: For category breakdown, still use findMany with select (need individual records)
      const expensesForCategory = await db.expense.findMany({
        where: dateFilter,
        select: { amount: true, category: true }
      })
      const expenseByCategory = expensesForCategory.reduce<Record<string, number>>((acc, e) => {
        acc[e.category] = (acc[e.category] || 0) + e.amount
        return acc
      }, {})

      return NextResponse.json({
        totalRevenue,
        totalCostOfGoods,
        grossProfit,
        totalExpenses,
        totalSalaries,  // v4.159: new field
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
        salaryCount,  // v4.159: new field
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

      // v4.59: Use aggregate for dashboard totals (DB-side computation)
      // Was: findMany → load all records → reduce in JS — much slower
      const [salesAgg, purchaseAgg, expenseAgg, invAgg, debtorAgg, creditorAgg, bankTxns, receiptsAgg, paymentsAgg, lowStockCount] = await Promise.all([
        db.sale.aggregate({ where: dateFilter, _sum: { totalAmount: true, amountPaid: true }, _count: true }),
        db.purchase.aggregate({ where: dateFilter, _sum: { totalAmount: true, amountPaid: true }, _count: true }),
        db.expense.aggregate({ where: dateFilter, _sum: { amount: true }, _count: true }),
        db.inventoryItem.aggregate({ where: { tenantId, isDeleted: false }, _sum: { value: true }, _count: true }),
        db.debtor.aggregate({ where: { tenantId, isDeleted: false }, _sum: { currentBalance: true } }),
        db.creditor.aggregate({ where: { tenantId, isDeleted: false }, _sum: { currentBalance: true } }),
        // v4.59.1: Fix — BankTransaction has deposit/withdrawal/balance, NOT amount/type
        db.bankTransaction.findMany({ where: { tenantId, isDeleted: false }, orderBy: { date: 'desc' }, take: 5, select: { id: true, date: true, description: true, deposit: true, withdrawal: true, balance: true, category: true, bankName: true } }),
        db.receipt.aggregate({ where: dateFilter, _sum: { amount: true }, _count: true }),
        db.payment.aggregate({ where: dateFilter, _sum: { amount: true }, _count: true }),
        db.inventoryItem.count({ where: { tenantId, isDeleted: false, currentStock: { lte: 0 } } }),
      ])

      const totalSales = salesAgg._sum.totalAmount || 0
      const totalPurchases = purchaseAgg._sum.totalAmount || 0
      const totalExpenses = expenseAgg._sum.amount || 0
      const totalInventoryValue = invAgg._sum.value || 0
      const debtorBalances = debtorAgg._sum.currentBalance || 0
      const unpaidSales = (salesAgg._sum.totalAmount || 0) - (salesAgg._sum.amountPaid || 0)
      const totalReceivable = debtorBalances + unpaidSales

      const creditorBalances = creditorAgg._sum.currentBalance || 0
      const unpaidPurchases = (purchaseAgg._sum.totalAmount || 0) - (purchaseAgg._sum.amountPaid || 0)
      const totalPayable = creditorBalances + unpaidPurchases
      const totalReceipts = receiptsAgg._sum.amount || 0
      const totalPayments = paymentsAgg._sum.amount || 0

      // v4.59: Use aggregate for monthly trend (was findMany + reduce — 6x slower)
      const now = new Date()
      const monthlyTrend: Array<{ month: string; sales: number; purchases: number; expenses: number }> = []
      for (let i = 5; i >= 0; i--) {
        const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
        const monthFilter = { tenantId, isDeleted: false, date: { gte: monthStart, lt: monthEnd } }

        const [monthSalesAgg, monthPurchasesAgg, monthExpensesAgg] = await Promise.all([
          db.sale.aggregate({ where: monthFilter, _sum: { totalAmount: true } }),
          db.purchase.aggregate({ where: monthFilter, _sum: { totalAmount: true } }),
          db.expense.aggregate({ where: monthFilter, _sum: { amount: true } }),
        ])

        monthlyTrend.push({
          month: monthStart.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
          sales: monthSalesAgg._sum.totalAmount || 0,
          purchases: monthPurchasesAgg._sum.totalAmount || 0,
          expenses: monthExpensesAgg._sum.amount || 0,
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
        inventoryCount: invAgg._count || 0,
        recentBankTxns: bankTxns,
        monthlyTrend,
        salesCount: salesAgg._count || 0,
        purchaseCount: purchaseAgg._count || 0,
        expenseCount: expenseAgg._count || 0,
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Reports error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
