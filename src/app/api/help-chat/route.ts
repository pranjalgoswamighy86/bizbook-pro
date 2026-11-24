import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { analyzeWithAI } from '@/lib/multi-ai'
import { requireAuthAndTenant } from '@/lib/api-helpers'

type ChatHistoryMessage = {
  role: 'user' | 'ai'
  content: string
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const tenantId = typeof body?.tenantId === 'string' ? body.tenantId : ''
    const message = typeof body?.message === 'string' ? body.message.trim() : ''

    if (!message || message.length > 4000) {
      return NextResponse.json(
        { error: 'Message is required and must be 4,000 characters or fewer' },
        { status: 400 }
      )
    }

    // The client may identify the currently selected tenant, but access is
    // always checked against the authenticated session before any data write.
    const auth = await requireAuthAndTenant(req, tenantId)
    if (auth instanceof NextResponse) return auth

    const tenant = await db.tenant.findUnique({
      where: { id: auth.tenantId },
      select: { name: true },
    })
    if (!tenant) {
      return NextResponse.json({ error: 'Selected business was not found' }, { status: 404 })
    }

    const history: ChatHistoryMessage[] = Array.isArray(body?.history)
      ? body.history
          .filter((item: any) =>
            item &&
            (item.role === 'user' || item.role === 'ai') &&
            typeof item.content === 'string'
          )
          .slice(-8)
          .map((item: any) => ({
            role: item.role,
            content: item.content.slice(0, 2000),
          }))
      : []

    const prompt = [
      'You are BizBook Pro customer support assistant for Indian small businesses.',
      'Answer clearly and practically. Do not claim to have accessed or changed account data.',
      'For account-specific actions, payment verification, tax filing, or unresolved technical issues, advise the user that the support team must review the case.',
      'Never ask for passwords, OTPs, API keys, or payment card details.',
      '',
      'Recent conversation:',
      ...history.map(item => `${item.role === 'user' ? 'Customer' : 'Assistant'}: ${item.content}`),
      '',
      `Customer's latest question: ${message}`,
      '',
      'Provide a concise, helpful answer. If the issue needs a human to investigate, say so explicitly.',
    ].join('\n')

    let provider = 'fallback'
    let response = 'Your question has been received by the support team. A team member may need to review it. Please do not share passwords or OTPs in chat.'
    let aiFailed = false

    try {
      const result = await analyzeWithAI(prompt, undefined, undefined)
      provider = result.provider || 'unknown'
      response = typeof result.result === 'string' && result.result.trim()
        ? result.result.trim()
        : response
    } catch (aiError) {
      aiFailed = true
      console.error('[HelpChat] AI response failed:', aiError)
    }

    // Persist the question and response for the admin support queue.
    await db.helpSupportTicket.create({
      data: {
        userId: auth.userId,
        userEmail: auth.email,
        tenantName: tenant.name,
        userQuery: message,
        optimizedQuery: message,
        aiResponse: response,
        category: 'General',
        needsHumanSupport: true,
        status: 'OPEN',
      },
    })

    return NextResponse.json({
      success: true,
      response,
      provider,
      ticketCreated: true,
      aiFallback: aiFailed,
    })
  } catch (error) {
    console.error('[HelpChat] Request failed:', error)
    return NextResponse.json({ error: 'Unable to send your support message right now' }, { status: 500 })
  }
}
