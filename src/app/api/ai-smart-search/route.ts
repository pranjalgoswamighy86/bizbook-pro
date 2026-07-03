/**
 * AI Smart Search API — Spec Section 4
 * Natural language search across all business data using ZAI
 * Features: NLP, semantic search, intent recognition, source citations
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

    const { query, tenantId } = body
    if (!query || query.trim().length < 2) {
      return NextResponse.json({ error: 'Query too short' }, { status: 400 })
    }

    // 1. Search across all entity types
    const [products, parties, sales, purchases, expenses, inventory, bankTxns, staff] = await Promise.all([
      db.product.findMany({ where: { tenantId, isDeleted: false, OR: [{ name: { contains: query, mode: 'insensitive' } }, { sku: { contains: query, mode: 'insensitive' } }] }, take: 5, select: { id: true, name: true, sku: true, salePrice: true } }),
      db.party.findMany({ where: { tenantId, isDeleted: false, OR: [{ name: { contains: query, mode: 'insensitive' } }, { phone: { contains: query } }, { gstin: { contains: query, mode: 'insensitive' } }] }, take: 5, select: { id: true, name: true, phone: true, partyType: true } }),
      db.sale.findMany({ where: { tenantId, isDeleted: false, OR: [{ invoiceNumber: { contains: query, mode: 'insensitive' } }, { partyName: { contains: query, mode: 'insensitive' } }] }, take: 5, select: { id: true, invoiceNumber: true, totalAmount: true, saleDate: true, partyName: true } }),
      db.purchase.findMany({ where: { tenantId, isDeleted: false, OR: [{ billNumber: { contains: query, mode: 'insensitive' } }, { partyName: { contains: query, mode: 'insensitive' } }] }, take: 5, select: { id: true, billNumber: true, totalAmount: true, purchaseDate: true, partyName: true } }),
      db.expense.findMany({ where: { tenantId, isDeleted: false, OR: [{ category: { contains: query, mode: 'insensitive' } }, { description: { contains: query, mode: 'insensitive' } }] }, take: 5, select: { id: true, category: true, amount: true, date: true } }),
      db.inventoryItem.findMany({ where: { tenantId, isDeleted: false, OR: [{ name: { contains: query, mode: 'insensitive' } }, { sku: { contains: query, mode: 'insensitive' } }, { hsnCode: { contains: query, mode: 'insensitive' } }] }, take: 5, select: { id: true, name: true, sku: true, currentStock: true } }),
      db.bankTransaction.findMany({ where: { tenantId, isDeleted: false, description: { contains: query, mode: 'insensitive' } }, take: 5, select: { id: true, description: true, deposit: true, withdrawal: true, date: true } }),
      db.staff.findMany({ where: { tenantId, isDeleted: false, OR: [{ name: { contains: query, mode: 'insensitive' } }, { phone: { contains: query } }] }, take: 3, select: { id: true, name: true, role: true, salary: true } }),
    ])

    // 2. Use ZAI for natural language understanding + synthesis
    let aiSummary = ''
    try {
      const ZAI = (await import('z-ai-web-dev-sdk')).default
      const zai = await ZAI.create()
      const allResults = JSON.stringify({ products, parties, sales, purchases, expenses, inventory, bankTxns, staff })
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'system', content: 'You are a business search assistant. Given search results from a business management system, provide a concise summary answering the user query. Include specific numbers and names. Keep it under 3 sentences.' },
          { role: 'user', content: `Query: "${query}"\n\nResults: ${allResults}\n\nSummarize the findings:` },
        ],
        temperature: 0.3,
      })
      aiSummary = completion.choices[0]?.message?.content || ''
    } catch { aiSummary = '' }

    // 3. Build structured results with citations
    const results = [
      ...products.map(p => ({ type: 'product', id: p.id, title: p.name, subtitle: `SKU: ${p.sku || '-'} | ₹${p.salePrice || 0}`, url: '/?view=inventory' })),
      ...parties.map(p => ({ type: 'party', id: p.id, title: p.name, subtitle: `${p.partyType || 'Party'} | ${p.phone || '-'}`, url: '/?view=company-select' })),
      ...sales.map(s => ({ type: 'sale', id: s.id, title: `Sale ${s.invoiceNumber}`, subtitle: `₹${s.totalAmount} | ${s.partyName} | ${s.saleDate?.toLocaleDateString()}`, url: '/?view=sales' })),
      ...purchases.map(p => ({ type: 'purchase', id: p.id, title: `Purchase ${p.billNumber}`, subtitle: `₹${p.totalAmount} | ${p.partyName}`, url: '/?view=purchases' })),
      ...expenses.map(e => ({ type: 'expense', id: e.id, title: e.category, subtitle: `₹${e.amount} | ${e.date?.toLocaleDateString()}`, url: '/?view=expenses' })),
      ...inventory.map(i => ({ type: 'inventory', id: i.id, title: i.name, subtitle: `Stock: ${i.currentStock} | SKU: ${i.sku || '-'}`, url: '/?view=inventory' })),
      ...bankTxns.map(b => ({ type: 'bank', id: b.id, title: b.description, subtitle: `${b.deposit > 0 ? '+' : ''}₹${b.deposit || -b.withdrawal}`, url: '/?view=bank' })),
      ...staff.map(s => ({ type: 'staff', id: s.id, title: s.name, subtitle: `${s.role} | ₹${s.salary}`, url: '/?view=staff' })),
    ]

    return NextResponse.json({
      query,
      aiSummary,
      totalResults: results.length,
      results: results.slice(0, 20),
    })
  } catch (error: any) {
    console.error('AI Smart Search error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
