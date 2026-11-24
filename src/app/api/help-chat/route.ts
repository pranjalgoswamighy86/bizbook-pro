import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { analyzeWithAI } from '@/lib/multi-ai'
import { requireAuthAndTenant } from '@/lib/api-helpers'
import { checkRateLimit } from '@/lib/rate-limit'

type ChatHistoryMessage = {
  role: 'user' | 'ai'
  content: string
}

// ============================================================
// v6.30.8: AI Support Chat — improved ticket routing + context
// ============================================================
// PREVIOUS BUGS (v6.30.7 and earlier):
//   1. `needsHumanSupport: true` was hardcoded for EVERY chat — even when
//      the AI gave a complete, correct answer. The admin support queue
//      filled up with tickets that needed no human action.
//   2. `category: 'General'` was hardcoded — tickets could not be triaged
//      by module (GST, login, billing, import, etc.).
//   3. `optimizedQuery: message` just echoed the raw message — no
//      optimization for the admin queue's ticket-title column.
//   4. No rate limit — any authenticated user could fire unbounded AI
//      requests, burning provider credits (Gemini/OpenAI/DeepSeek).
//
// FIXES (v6.30.8):
//   • needsHumanSupport is now computed: true if (a) AI provider failed,
//     OR (b) the message contains an explicit escalation keyword
//     ("human", "agent", "manager", "call me", "talk to", "support team").
//   • category is auto-classified by keyword matching against 9 modules.
//   • optimizedQuery is a trimmed, single-line summary (≤80 chars) of the
//     message — suitable for the admin ticket list.
//   • Rate limit: 10 messages per minute per user (chat-specific bucket).
//   • System prompt now includes app version + feature list so the AI can
//     answer product questions accurately instead of guessing.
// ============================================================

const ESCALATION_KEYWORDS = [
  'human', 'agent', 'manager', 'support team', 'talk to',
  'call me', 'phone', 'callback', 'escalate', 'urgent',
  'lawyer', 'legal', 'complaint', 'speak to',
]

const CATEGORY_RULES: Array<{ category: string; keywords: string[] }> = [
  { category: 'Authentication', keywords: ['login', 'logout', 'password', 'otp', 'register', 'sign in', 'sign up', 'forgot', 'session', '2fa'] },
  { category: 'GST & Taxation', keywords: ['gst', 'cgst', 'sgst', 'igst', 'hsn', 'sac', 'e-invoice', 'einvoice', 'irn', 'gstr', 'tax', 'cess'] },
  { category: 'Sales', keywords: ['sale', 'invoice', 'bill', 'customer', 'party', 'quotation', 'receipt', 'debtor'] },
  { category: 'Purchases', keywords: ['purchase', 'vendor', 'supplier', 'creditor', 'grn'] },
  { category: 'Inventory', keywords: ['inventory', 'stock', 'product', 'item', 'bom', 'barcode'] },
  { category: 'Accounting', keywords: ['journal', 'ledger', 'trial balance', 'p&l', 'profit', 'loss', 'balance sheet', 'account', 'double-entry', 'gl'] },
  { category: 'AI Import', keywords: ['import', 'csv', 'excel', 'pdf', 'upload', 'ai import', 'smart import', 'bulk'] },
  { category: 'Subscription & Billing', keywords: ['subscription', 'plan', 'recharge', 'payment', 'razorpay', 'upi', 'free tier', 'wallet'] },
  { category: 'Backup & Export', keywords: ['backup', 'export', 'restore', 'drive'] },
]

function classifyCategory(message: string): string {
  const lower = message.toLowerCase()
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) return rule.category
  }
  return 'General'
}

function detectEscalation(message: string): boolean {
  const lower = message.toLowerCase()
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw))
}

function buildOptimizedQuery(message: string): string {
  // Collapse whitespace, trim, cap at 80 chars for the ticket list.
  const cleaned = message.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= 80) return cleaned
  return cleaned.slice(0, 77) + '...'
}

const APP_VERSION = 'v6.30.7'

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

    const auth = await requireAuthAndTenant(req, tenantId)
    if (auth instanceof NextResponse) return auth

    // v6.30.8: Rate limit — 10 msgs per minute per user (chat-specific bucket).
    // Blocks AI credit abuse without affecting legitimate back-and-forth.
    const rlKey = `chat:${auth.userId}`
    const rl = checkRateLimit(rlKey, { maxRequests: 10, windowMs: 60 * 1000 })
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error: `You're sending messages too quickly. Please wait ${rl.retryAfterSeconds}s and try again.`,
          code: 'RATE_LIMITED',
          retryAfterSeconds: rl.retryAfterSeconds,
        },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      )
    }

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

    // v6.30.8: Richer system prompt — tells the AI what BizBook Pro is,
    // what features exist, and what version is deployed. Lets the AI answer
    // product/version questions instead of guessing.
    const prompt = [
      'You are BizBook Pro customer support assistant for Indian small businesses.',
      `BizBook Pro is a production-grade business management suite (${APP_VERSION}) covering:`,
      '- Sales (GST invoices, quotations, receipts) and Purchases (vendor bills, GRN)',
      '- Inventory (BOM, multi-unit, barcode, HSN) with anti-negative-stock enforcement',
      '- Double-entry accounting (Journal Entries, GL posting, Trial Balance, P&L, Balance Sheet)',
      '- GST utilities (GSTIN validation + checksum, CGST/SGST/IGST split, HSN validation, e-invoice IRN)',
      '- AI Smart Import (CSV/Excel/PDF/image → structured sales/purchases/expenses)',
      '- AI Invoice Analyzer (image/PDF → structured purchase with auto-inventory update)',
      '- Subscriptions via Razorpay/UPI; OTP via Brevo email + 2Factor SMS',
      '',
      'Answer clearly and practically. Respond in English only.',
      'Do not claim to have accessed or changed account data.',
      'For account-specific actions (refund, payment verification, tax filing, or any irreversible change), advise that the support team must review.',
      'Never ask for passwords, OTPs, API keys, or card details.',
      'If the user explicitly asks for a human or escalation, say you are flagging the conversation for the support team.',
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

    // v6.30.8: Compute category + escalation flag + optimized title
    const category = classifyCategory(message)
    const escalationRequested = detectEscalation(message)
    const needsHumanSupport = aiFailed || escalationRequested
    const optimizedQuery = buildOptimizedQuery(message)

    // Persist the question and response for the admin support queue.
    await db.helpSupportTicket.create({
      data: {
        userId: auth.userId,
        userEmail: auth.email,
        tenantName: tenant.name,
        userQuery: message,
        optimizedQuery,
        aiResponse: response,
        category,
        needsHumanSupport,
        status: 'OPEN',
      },
    })

    return NextResponse.json({
      success: true,
      response,
      provider,
      ticketCreated: true,
      aiFallback: aiFailed,
      category,
      needsHumanSupport,
      optimizedQuery,
    })
  } catch (error) {
    console.error('[HelpChat] Request failed:', error)
    return NextResponse.json({ error: 'Unable to send your support message right now' }, { status: 500 })
  }
}
