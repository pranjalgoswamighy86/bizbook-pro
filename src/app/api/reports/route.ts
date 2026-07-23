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

      // v6.27.5: CRITICAL FIX — use subtotal (excl GST) for revenue, not totalAmount.
      // Previously revenue included GST collected, which overstated gross profit
      // by the entire GST liability. GST is a liability (payable to government),
      // not revenue. COGS was already correctly using subtotal.
      const totalRevenue = salesAgg._sum.subtotal || 0
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
      // v6.27.5: SECURITY FIX — add authentication. Previously this action
      // had no auth check, allowing unauthenticated access to full daily
      // transaction lists (sales, purchases, expenses, receipts, payments).
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

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
      // v6.27.5: SECURITY FIX — add authentication. Previously this action
      // had no auth check, allowing unauthenticated disclosure of the full
      // financial position (assets, liabilities, equity) of any tenant.
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      // v6.28.0: CRITICAL REWRITE — read from the General Ledger instead of
      // operational tables. Previously this action summed Sale/Purchase/Expense/
      // Inventory/Debtor/Creditor tables directly, bypassing the double-entry
      // system entirely. This caused:
      //   - BS to never balance (assets ≠ liabilities + equity)
      //   - BS to drift from Trial Balance (which DOES read the GL)
      //   - Double-counting (Debtor.currentBalance + Sale.totalAmount - amountPaid)
      //   - GST collected counted as revenue (inflated retained earnings)
      //   - No support for asOfDate (always summed all-time data)
      //
      // Now we aggregate JournalEntryLine by Account.type, filtered by
      // isPosted:true and entryDate < asOfDate. This makes the BS reconcilable
      // with the Trial Balance by construction.
      const { asOfDate } = body
      const entryDateFilter: Record<string, unknown> = { tenantId: access.tenantId, isPosted: true }
      if (asOfDate) {
        entryDateFilter.entryDate = { lt: new Date(asOfDate) }
      }

      // Fetch all accounts for this tenant
      const accounts = await db.account.findMany({
        where: { tenantId: access.tenantId, isActive: true },
        orderBy: [{ type: 'asc' }, { accountCode: 'asc' }],
      })

      // Aggregate all JELines per account in a single query (avoids N+1)
      const grouped = await db.journalEntryLine.groupBy({
        by: ['accountId'],
        where: { entry: entryDateFilter },
        _sum: { debit: true, credit: true },
      })

      // Build a map of accountId → net balance
      const balanceByAccount: Record<string, number> = {}
      for (const g of grouped) {
        const debit = g._sum.debit || 0
        const credit = g._sum.credit || 0
        balanceByAccount[g.accountId] = Math.round((debit - credit) * 100) / 100
      }

      // Helper: sum balances for accounts of a given type, optionally filtered by code prefix
      const sumByType = (type: string, codePrefixes?: string[]) => {
        return accounts
          .filter(a => a.type === type && (!codePrefixes || codePrefixes.some(p => a.accountCode.startsWith(p))))
          .reduce((s, a) => s + (balanceByAccount[a.id] || 0), 0)
      }
      // Helper: get a single account balance by code
      const balanceByCode = (code: string): number => {
        const acc = accounts.find(a => a.accountCode === code)
        return acc ? (balanceByAccount[acc.id] || 0) : 0
      }

      // v6.28.0: Asset balances are debit-natured (positive = debit balance).
      // Liability and Equity balances are credit-natured (positive = credit balance,
      // so debit - credit gives a negative number; we negate for display).
      const cashBalance = Math.max(0, balanceByCode('10100'))
      const bankBalance = Math.max(0, balanceByCode('10200'))
      const accountsReceivable = Math.max(0, balanceByCode('10300'))
      const inventoryBalance = Math.max(0, balanceByCode('10400'))
      const gstInputCredit = Math.max(0,
        balanceByCode('10601') + balanceByCode('10602') + balanceByCode('10603') + balanceByCode('50600'))
      const otherAssets = Math.max(0,
        sumByType('Asset', ['10500', '10600', '10700', '10800', '10900'])
        - cashBalance - bankBalance - accountsReceivable - inventoryBalance - gstInputCredit)

      const totalAssets = cashBalance + bankBalance + accountsReceivable + inventoryBalance + gstInputCredit + otherAssets

      const accountsPayable = Math.max(0, -balanceByCode('20100'))
      const gstPayable = Math.max(0,
        -(balanceByCode('20200') + balanceByCode('20201') + balanceByCode('20202') + balanceByCode('20203')))
      const tdsPayable = Math.max(0, -balanceByCode('20300'))
      const loans = Math.max(0, -balanceByCode('20400'))
      const accruedExpenses = Math.max(0, -balanceByCode('20500'))
      const otherLiabilities = Math.max(0,
        -(sumByType('Liability', ['20600', '20700', '20800', '20900']))
        - accountsPayable - gstPayable - tdsPayable - loans - accruedExpenses)

      const totalLiabilities = accountsPayable + gstPayable + tdsPayable + loans + accruedExpenses + otherLiabilities

      const capital = Math.max(0, -balanceByCode('30100'))
      const retainedEarnings = Math.max(0, -balanceByCode('30200'))
      const drawings = Math.max(0, balanceByCode('30300')) // contra-equity, debit balance
      const totalEquity = capital + retainedEarnings - drawings

      return NextResponse.json({
        asOfDate: asOfDate || null,
        assets: {
          cash: cashBalance,
          bankBalance,
          accountsReceivable,
          inventory: inventoryBalance,
          gstInputCredit,
          other: otherAssets,
          total: totalAssets,
        },
        liabilities: {
          accountsPayable,
          gstPayable,
          tdsPayable,
          loans,
          accruedExpenses,
          other: otherLiabilities,
          total: totalLiabilities,
        },
        equity: {
          capital,
          retainedEarnings,
          drawings,
          total: totalEquity,
        },
        totalAssetsLiabilities: totalAssets,
        totalLiabilitiesEquity: totalLiabilities + totalEquity,
        isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
        // v6.28.0: include the difference so the UI can show it
        difference: Math.round((totalAssets - totalLiabilities - totalEquity) * 100) / 100,
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
      const [salesAgg, purchaseAgg, expenseAgg, invAgg, debtorAgg, creditorAgg, bankTxns, receiptsAgg, paymentsAgg, lowStockCount, salaryAgg] = await Promise.all([
        db.sale.aggregate({ where: dateFilter, _sum: { totalAmount: true, amountPaid: true, subtotal: true, gstAmount: true }, _count: true }),
        db.purchase.aggregate({ where: dateFilter, _sum: { totalAmount: true, amountPaid: true, subtotal: true }, _count: true }),
        db.expense.aggregate({ where: dateFilter, _sum: { amount: true }, _count: true }),
        db.inventoryItem.aggregate({ where: { tenantId, isDeleted: false }, _sum: { value: true }, _count: true }),
        db.debtor.aggregate({ where: { tenantId, isDeleted: false }, _sum: { currentBalance: true } }),
        db.creditor.aggregate({ where: { tenantId, isDeleted: false }, _sum: { currentBalance: true } }),
        // v4.59.1: Fix — BankTransaction has deposit/withdrawal/balance, NOT amount/type
        db.bankTransaction.findMany({ where: { tenantId, isDeleted: false }, orderBy: { date: 'desc' }, take: 5, select: { id: true, date: true, description: true, deposit: true, withdrawal: true, balance: true, category: true, bankName: true } }),
        db.receipt.aggregate({ where: dateFilter, _sum: { amount: true }, _count: true }),
        db.payment.aggregate({ where: dateFilter, _sum: { amount: true }, _count: true }),
        db.inventoryItem.count({ where: { tenantId, isDeleted: false, currentStock: { lte: 0 } } }),
        // v6.27.5: Include salary payments in the dashboard net-profit calculation.
        // Use the dashboard's date filter on paidDate so salaries respect the
        // selected date range (was missing — caused dashboard net profit to
        // differ from P&L by the entire salary expense).
        db.salaryPayment.aggregate({
          where: { tenantId, isDeleted: false, paidDate: startDate && endDate ? { gte: new Date(startDate), lt: new Date(endDate) } : undefined },
          _sum: { amount: true },
        }),
      ])

      const totalSales = salesAgg._sum.totalAmount || 0
      const totalPurchases = purchaseAgg._sum.totalAmount || 0
      const totalExpenses = expenseAgg._sum.amount || 0
      // v6.27.5: guard against _sum being null when there are no salary payments
      const totalSalaries = (salaryAgg._sum && 'amount' in salaryAgg._sum ? (salaryAgg._sum as any).amount : 0) || 0
      const totalInventoryValue = invAgg._sum.value || 0

      // v6.27.5: CRITICAL FIX — remove double-counting of receivables/payables.
      // Previously the dashboard summed `Debtor.currentBalance` AND
      // `Sale.totalAmount - Sale.amountPaid`. But the Sale CREATE flow already
      // writes the unpaid amount into `Debtor.currentBalance` (sales/route.ts:242-277),
      // so the same ₹X was counted twice. Same for purchases → creditors.
      // Now we use ONLY the Debtor/Creditor balances, which are the canonical AP/AR.
      const totalReceivable = debtorAgg._sum.currentBalance || 0
      const totalPayable = creditorAgg._sum.currentBalance || 0
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
        totalSalaries,
        totalInventoryValue,
        totalReceivable,
        totalPayable,
        totalReceipts,
        totalPayments,
        // v6.27.5: CRITICAL FIX — align dashboard net profit with P&L.
        // Previously: totalSales (incl GST) - totalPurchases (incl GST) - totalExpenses.
        // This double-counted GST (GST collected counted as revenue, GST paid counted as expense)
        // and omitted salaries entirely. Now uses:
        //   revenue (excl GST) - COGS (excl GST) - operating expenses - salaries
        // which matches the P&L calculation at reports/route.ts:50-57.
        netProfit: (salesAgg._sum.subtotal || 0) - (purchaseAgg._sum.subtotal || 0) - totalExpenses - totalSalaries,
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
