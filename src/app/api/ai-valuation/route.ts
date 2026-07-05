import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { analyzeWithAI } from '@/lib/multi-ai';
import { requireAuthAndTenant } from '@/lib/api-helpers';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { tenantId, query, searchResults } = body;

    const auth = await requireAuthAndTenant(req, tenantId);
    if (auth instanceof NextResponse) return auth;

    if (!query) {
      return NextResponse.json({ error: 'No search query provided' }, { status: 400 });
    }

    // Search across modules
    const results: any[] = [];

    // Search sales
    if (!searchResults || searchResults.includes('sales')) {
      const sales = await db.sale.findMany({
        where: {
          tenantId,
          OR: [
            { invoiceNumber: { contains: query, mode: 'insensitive' } },
            { partyName: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: 5,
        select: { id: true, invoiceNumber: true, partyName: true, totalAmount: true, createdAt: true },
      });
      results.push(...sales.map(s => ({ ...s, type: 'sale' })));
    }

    // Search purchases
    if (!searchResults || searchResults.includes('purchases')) {
      const purchases = await db.purchase.findMany({
        where: {
          tenantId,
          OR: [
            { invoiceNumber: { contains: query, mode: 'insensitive' } },
            { partyName: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: 5,
        select: { id: true, invoiceNumber: true, partyName: true, totalAmount: true, createdAt: true },
      });
      results.push(...purchases.map(p => ({ ...p, type: 'purchase' })));
    }

    // Search inventory
    if (!searchResults || searchResults.includes('inventory')) {
      const items = await db.inventoryItem.findMany({
        where: {
          tenantId,
          name: { contains: query, mode: 'insensitive' },
        },
        take: 5,
        select: { id: true, name: true, sku: true, currentStock: true, salePrice: true },
      });
      results.push(...items.map(i => ({ ...i, type: 'inventory' })));
    }

    // Search parties
    if (!searchResults || searchResults.includes('parties')) {
      const parties = await db.party.findMany({
        where: {
          tenantId,
          name: { contains: query, mode: 'insensitive' },
        },
        take: 5,
        select: { id: true, name: true, phone: true, gst: true },
      });
      results.push(...parties.map(p => ({ ...p, type: 'party' })));
    }

    // AI Summary
    const prompt = `Search query: "${query}"
    Found these results:
    ${JSON.stringify(results.slice(0, 10), null, 2)}
    
    Provide a concise summary (2-3 sentences) of what was found.`;

    try {
      const { provider, result } = await analyzeWithAI(prompt, undefined, undefined);

      return NextResponse.json({
        success: true,
        provider,
        summary: result,
        results: results.slice(0, 10),
        total: results.length,
      });
    } catch (aiError: any) {
      console.error('[AI-Smart-Search] AI failed:', aiError);
      return NextResponse.json({
        success: true,
        provider: 'fallback',
        summary: `Found ${results.length} results for "${query}"`,
        results: results.slice(0, 10),
        total: results.length,
      });
    }
  } catch (error: any) {
    console.error('[AI-Smart-Search] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
