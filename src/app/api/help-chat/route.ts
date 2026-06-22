/**
 * Help Chat API (v4.63)
 * ======================
 * Receives user's query, gets AI response, creates support ticket.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuth } from '@/lib/api-helpers'
import { getZaiClient } from '@/lib/zai-client'

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth

    const body = await req.json()
    const { message, userEmail, tenantName, history } = body

    if (!message || !message.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    // Get AI response
    let aiResponse = ''
    let optimizedQuery = message.trim()
    let category = 'General'
    let needsHumanSupport = false

    try {
      const zai = await getZaiClient()
      const completion = await zai.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: `You are a helpful support assistant for BizBook Pro accounting software by Tahigo International. Respond in ENGLISH ONLY. NEVER share any email addresses, phone numbers, or personal contact information. Keep responses concise (max 3 sentences). If the user's issue is about: payments, subscription activation, account deletion, or requires admin action — set needsHumanSupport to true. Return JSON: {"response":"your answer","optimizedQuery":"clean summary of user's issue","category":"Registration|OTP|Payment|Inventory|Invoice|Account|Bug|Other","needsHumanSupport":true/false}`,
          },
          ...(history || []).map((m: any) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content })),
          { role: 'user', content: message.trim() },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      })

      const content = completion.choices[0]?.message?.content || '{}'
      const parsed = JSON.parse(content)
      aiResponse = parsed.response || 'I apologize, I could not process your request.'
      optimizedQuery = parsed.optimizedQuery || message.trim()
      category = parsed.category || 'General'
      needsHumanSupport = parsed.needsHumanSupport || false
    } catch (aiErr: any) {
      console.error('[HELP-CHAT] AI error:', aiErr?.message)
      aiResponse = 'I\'m having trouble processing your request right now. Your query has been forwarded to our support team — they'll get back to you soon.'
      needsHumanSupport = true
    }

    // Create support ticket (always — so admin can review)
    let ticketCreated = false
    try {
      await db.helpSupportTicket.create({
        data: {
          userId: auth.userId,
          userEmail: userEmail || 'unknown',
          tenantName: tenantName || 'unknown',
          userQuery: message.trim(),
          optimizedQuery,
          aiResponse,
          category,
          needsHumanSupport,
          status: needsHumanSupport ? 'OPEN' : 'AI_RESOLVED',
        },
      })
      ticketCreated = true
      console.log(`[HELP-CHAT] Ticket created: ${category} — "${optimizedQuery}" (human: ${needsHumanSupport})`)
    } catch (dbErr: any) {
      console.warn('[HELP-CHAT] Could not create ticket:', dbErr?.message)
    }

    return NextResponse.json({
      response: aiResponse,
      ticketCreated,
      needsHumanSupport,
    })
  } catch (error: any) {
    console.error('[HELP-CHAT] Error:', error?.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
