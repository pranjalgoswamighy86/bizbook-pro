import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndTenant } from '@/lib/api-helpers'

/**
 * Autocomplete Index API
 *
 * Per spec Rule 3.1: "The moment a user confirms and commits an AI Smart
 * Import transaction, every saved text block must be indexed down to the
 * local database cache."
 *
 * Actions:
 *   GET  ?tenantId=X&fieldType=item_name&query=gar  → returns matching suggestions
 *   POST { action: 'save', tenantId, fieldType, value, source }
 *        → saves (or increments useCount if exists)
 *   POST { action: 'save-batch', tenantId, entries: [{fieldType, value, source}] }
 *        → saves multiple entries at once (called after AI import)
 *   POST { action: 'list', tenantId, fieldType }
 *        → returns all entries for a field type
 */

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenantId') || ''
  const fieldType = url.searchParams.get('fieldType') || ''
  const query = url.searchParams.get('query') || ''
  const limit = parseInt(url.searchParams.get('limit') || '20')

  if (!tenantId || !fieldType) {
    return NextResponse.json({ error: 'tenantId and fieldType are required' }, { status: 400 })
  }

  // Auth check
  const auth = await requireAuthAndTenant(req, tenantId)
  if (auth instanceof NextResponse) return auth

  // Query the autocomplete index
  // Filter by tenantId + fieldType + value starts with query (case-insensitive)
  // Order by lastUsedAt desc (most recent first), then useCount desc
  const where: any = { tenantId, fieldType }
  if (query) {
    where.value = { startsWith: query }
  }

  const entries = await db.autocompleteIndex.findMany({
    where,
    orderBy: [{ lastUsedAt: 'desc' }, { useCount: 'desc' }],
    take: limit,
    select: { id: true, value: true, useCount: true, source: true, lastUsedAt: true },
  })

  return NextResponse.json({
    suggestions: entries.map(e => e.value),
    entries,
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
    }

    // Auth check
    const auth = await requireAuthAndTenant(req, tenantId)
    if (auth instanceof NextResponse) return auth

    // === SAVE a single value ===
    if (action === 'save') {
      const { fieldType, value, source } = body
      if (!fieldType || !value) {
        return NextResponse.json({ error: 'fieldType and value are required' }, { status: 400 })
      }

      const cleanValue = String(value).trim()
      if (!cleanValue) {
        return NextResponse.json({ success: true, skipped: true })
      }

      // Upsert: if exists, increment useCount + update lastUsedAt
      // If not, create new entry
      const existing = await db.autocompleteIndex.findUnique({
        where: {
          tenantId_fieldType_value: { tenantId, fieldType, value: cleanValue },
        },
      })

      if (existing) {
        await db.autocompleteIndex.update({
          where: { id: existing.id },
          data: {
            useCount: { increment: 1 },
            lastUsedAt: new Date(),
            source: source === 'ai_import' ? 'ai_import' : existing.source,
          },
        })
      } else {
        await db.autocompleteIndex.create({
          data: {
            tenantId,
            fieldType,
            value: cleanValue,
            source: source || 'manual',
          },
        })
      }

      return NextResponse.json({ success: true })
    }

    // === SAVE BATCH (called after AI import — saves all extracted text strings) ===
    if (action === 'save-batch') {
      const { entries } = body as { entries: Array<{ fieldType: string; value: string; source?: string }> }
      if (!entries || !Array.isArray(entries) || entries.length === 0) {
        return NextResponse.json({ success: true, saved: 0 })
      }

      let saved = 0
      for (const entry of entries) {
        const cleanValue = String(entry.value || '').trim()
        if (!cleanValue || !entry.fieldType) continue

        const existing = await db.autocompleteIndex.findUnique({
          where: {
            tenantId_fieldType_value: { tenantId, fieldType: entry.fieldType, value: cleanValue },
          },
        })

        if (existing) {
          await db.autocompleteIndex.update({
            where: { id: existing.id },
            data: {
              useCount: { increment: 1 },
              lastUsedAt: new Date(),
              source: entry.source === 'ai_import' ? 'ai_import' : existing.source,
            },
          })
        } else {
          await db.autocompleteIndex.create({
            data: {
              tenantId,
              fieldType: entry.fieldType,
              value: cleanValue,
              source: entry.source || 'ai_import',
            },
          })
        }
        saved++
      }

      console.log(`[AUTOCOMPLETE] Saved ${saved} autocomplete entries for tenant ${tenantId}`)
      return NextResponse.json({ success: true, saved })
    }

    // === LIST all entries for a field type ===
    if (action === 'list') {
      const { fieldType } = body
      if (!fieldType) {
        return NextResponse.json({ error: 'fieldType is required' }, { status: 400 })
      }

      const entries = await db.autocompleteIndex.findMany({
        where: { tenantId, fieldType },
        orderBy: [{ lastUsedAt: 'desc' }, { useCount: 'desc' }],
        take: 100,
        select: { id: true, value: true, useCount: true, source: true, lastUsedAt: true },
      })

      return NextResponse.json({ entries })
    }

    return NextResponse.json({ error: 'Invalid action. Use: save, save-batch, list' }, { status: 400 })
  } catch (error) {
    console.error('Autocomplete API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
