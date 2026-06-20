/**
 * AI Company Valuation API
 * Server-side ZAI call — fetches financial data + generates valuation
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndTenant } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const access = await requireAuthAndTenant(req, body.tenantId)
    if (access instanceof NextResponse) return access

    const tenantId = access.tenantId

    // Fetch financial data
    const [sales, purchases, expenses, inventory] = await Promise.all([
      db.sale.findMany({ where: { tenantId, isDeleted: false }, select: { totalAmount: true } }),
      db.purchase.findMany({ where: { tenantId, isDeleted: false }, select: { totalAmount: true } }),
      db.expense.findMany({ where: { tenantId, isDeleted: false }, select: { amount: true } }),
      db.inventoryItem.findMany({ where: { tenantId, isDeleted: false }, select: { currentStock: true, purchasePrice: true } }),
    ])

    const totalSales = sales.reduce((s, x) => s + (x.totalAmount || 0), 0)
    const totalPurchases = purchases.reduce((s, x) => s + (x.totalAmount || 0), 0)
    const totalExpenses = expenses.reduce((s, x) => s + (x.amount || 0), 0)
    const inventoryValue = inventory.reduce((s, x) => s + (x.currentStock || 0) * (x.purchasePrice || 0), 0)
    const netProfit = totalSales - totalPurchases - totalExpenses

    const financialData = { totalSales, totalPurchases, totalExpenses, netProfit, inventoryValue, salesCount: sales.length, purchaseCount: purchases.length }

    // Call ZAI
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    // v4.50: Use getZaiClient() for Railway fallback config
    const { getZaiClient } = await import('@/lib/zai-client')
    const zai = await getZaiClient()

    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `You are a professional business valuation expert AI. Analyze the financial data and provide a comprehensive company valuation in Indian Rupees. Return JSON: {"valuationRange":{"low":number,"mid":number,"high":number},"valuationMethod":"string","financialHealthScore":number,"healthGrade":"string","keyStrengths":["string"],"keyRisks":["string"],"growthTrend":"string","recommendations":["string"],"summary":"string"}`,
        },
        { role: 'user', content: `Analyze: ${JSON.stringify(financialData)}. Provide valuation as JSON.` },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    })

    const result = JSON.parse(completion.choices[0]?.message?.content || '{}')
    return NextResponse.json({ valuation: result, financialData })
  } catch (error: any) {
    console.error('AI Valuation error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
