/**
 * v4.151: Help Chat API
 * ============================================================
 * Uses multi-ai.ts abstraction (ZAI → OpenAI → Gemini → Claude fallback).
 *
 * What changed from v4.85:
 * 1. Wired to multi-ai abstraction — no longer hard-coded to ZAI only
 * 2. Rich system prompt with BizBook Pro knowledge base
 * 3. Detects user intent (Registration, OTP, Payment, Inventory, Invoice, Account, Bug, Other)
 * 4. Smart suggestions when AI is down
 * 5. Persists tickets with provider info for analytics
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuth } from '@/lib/api-helpers'
import { analyzeWithAI, getAvailableProviders } from '@/lib/multi-ai'

export const dynamic = 'force-dynamic'

// ============================================================
// BizBook Pro Knowledge Base (fed to AI as system prompt)
// ============================================================
const BIZBOOK_KB = `
BIZBOOK PRO KNOWLEDGE BASE (Tahigo International):

PLANS & PRICING:
- 50Hrs: ₹150 (MRP ₹749, 80% off) — ₹3/hr — 10h Main Admin, 15h Junior, 25h Data Entry
- 100Hrs: ₹217 (MRP ₹1,449, 85% off) — ₹2.2/hr — 20h Main Admin, 30h Junior, 50h Data Entry
- 200Hrs: ₹285 (MRP ₹2,849, 90% off) — ₹1.4/hr — 40h Main Admin, 60h Junior, 100h Data Entry [MOST POPULAR]
- 500Hrs: ₹493 (MRP ₹7,049, 93% off) — ₹1.0/hr — 80h Main Admin, 120h Junior, 200h Data Entry
- 1000Hrs: ₹562 (MRP ₹14,049, 96% off) — ₹0.6/hr — 40h Main Admin, 60h Junior, 100h Data Entry
- View-Only users: ALWAYS FREE, no limit
- Extra ID (Junior Admin / Data Entry): ₹149 one-time + 15% surcharge on all future recharges

REGISTRATION:
- OTP bypass: if email/SMS not configured, OTP is returned in API response and shown in amber banner on screen
- Master mobile 9101555075 can register multiple accounts (bypasses phone uniqueness)
- OTP goes to the user's entered mobile, NOT the master mobile
- Login is case-insensitive (PRISMA WASM doesn't support mode:insensitive, uses raw query)

PAYMENTS:
- Razorpay Standard Checkout (test mode: rzp_test_, live mode: rzp_live_)
- Auto-verification via HMAC-SHA256 signature
- Plans activate INSTANTLY after successful payment
- If Razorpay not configured, fallback to MANUAL mode (admin activates manually)
- Razorpay fee: 2% on subtotal + 18% GST on the fee (added to customer's total)

KEY MODULES (29+):
- Sales & Purchase Registers (GST-compliant invoicing)
- Inventory Management (BOM, batch/expiry, anti-negative stock)
- Double-Entry Accounting (Journal entries, Trial Balance, P&L, Balance Sheet)
- Credit/Debit Notes (GST Section 34 compliant)
- Staff & Payroll (with biometric attendance — fingerprint scanner support)
- AI Smart Import (PDF/Image → auto-fill 12+ fields, multi-provider: ZAI → OpenAI → Gemini → Claude)
- AI Business Valuation (DCF + Revenue/EBITDA multiples + Asset-based)
- AI Support Chat (this feature)
- GST Reports (GSTR-1, GSTR-3B with HSN summary, GSTR-9 annual return)
- E-Invoice (IRN/AckNo — manual workflow, payload generator ready)
- Barcode scanner (per-item print, bulk scan in registers)
- Trial Balance (visible in sidebar, opens General Ledger with initialTab="trial")
- Bank Reconciliation
- Chart of Accounts (26 standard accounts)

ROLES (5-tier RBAC):
- VIEW_ONLY: Read-only access, always free
- DATA_ENTRY: Create sales/purchases/expenses, no admin actions
- JUNIOR_ADMIN: Data Entry + reports + edit existing records
- MAIN_ADMIN: Full tenant access except super admin functions
- SUPER_ADMIN: Cross-tenant, manages all subscriptions

COMMON ISSUES & SOLUTIONS:
- "OTP not received": Check amber banner on screen (OTP bypass mode). If email/SMS configured, check spam folder. Master mobile users: OTP goes to entered mobile, not master.
- "Login failed — case-insensitive": Email is case-insensitive. Try lowercase.
- "Payment failed": Razorpay Standard Checkout modal opens. If "Authentication failed", admin needs to verify RAZORPAY_KEY_ID/SECRET on Railway.
- "Hours exhausted": Users auto-convert to View-Only. Recharge to restore.
- "Cannot delete tenant": All tenants are protected (soft-delete only). Contact super admin.
- "Negative amount rejected": Sales/Purchases APIs reject negative amounts (HTTP 422).
- "Trial balance not visible": It's in the sidebar under "General Ledger" → Trial Balance tab.

DEPLOYMENT:
- Production: https://carefree-success-production-7766.up.railway.app/
- Marketing site: https://www.tahigo.in
- Office: Guwahati, Assam
- Stack: Next.js 16 + React 19 + Prisma 6 (PostgreSQL) + Tailwind 4

SECURITY:
- 5-minute AFK auto-logout
- Multi-tenant row-level isolation
- Soft-delete (records never truly deleted)
- Audit log on all CREATE/UPDATE/DELETE
- OTP via Email + SMS for registration
`

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth

    const body = await req.json()
    const { message, userEmail, tenantName, history } = body

    if (!message || !message.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    // ============================================================
    // 1. Get AI response via multi-provider abstraction
    // ============================================================
    let aiResponse = ''
    let optimizedQuery = message.trim()
    let category = 'General'
    let needsHumanSupport = false
    let provider = 'none'
    const availableProviders = getAvailableProviders()

    if (availableProviders.length === 0) {
      // No AI configured — provide canned responses for common queries
      aiResponse = getCannedResponse(message.trim())
      needsHumanSupport = ['payment', 'subscription', 'account deletion', 'admin action'].some(k =>
        message.toLowerCase().includes(k)
      )
      category = detectCategory(message.trim())
    } else {
      try {
        const aiResult = await analyzeWithAI(
          [
            {
              role: 'system',
              content: `You are a helpful support assistant for BizBook Pro accounting software by Tahigo International. ALWAYS respond in ENGLISH ONLY. Never share any email addresses, phone numbers, or personal contact information. Keep responses concise (max 3 sentences, friendly tone).

Use this knowledge base to answer:
${BIZBOOK_KB}

If the user's issue requires admin action (payment refund, account deletion, plan modification, subscription activation), set needsHumanSupport to true.

Return JSON: {"response":"your answer","optimizedQuery":"clean summary of user's issue","category":"Registration|OTP|Payment|Inventory|Invoice|Account|Bug|Other","needsHumanSupport":true/false}`,
            },
            ...(history || []).slice(-5).map((m: any) => ({
              role: m.role === 'ai' ? 'assistant' : 'user',
              content: m.content,
            })),
            { role: 'user', content: message.trim() },
          ],
          { jsonMode: true, timeout: 30000 }
        )

        provider = aiResult.provider
        const parsed = JSON.parse(aiResult.content)
        aiResponse = parsed.response || 'I apologize, I could not process your request.'
        optimizedQuery = parsed.optimizedQuery || message.trim()
        category = parsed.category || 'General'
        needsHumanSupport = parsed.needsHumanSupport || false
      } catch (aiErr: any) {
        console.error('[HELP-CHAT] AI error:', aiErr?.message)
        aiResponse = getCannedResponse(message.trim())
        needsHumanSupport = true
        category = detectCategory(message.trim())
      }
    }

    // ============================================================
    // 2. Create support ticket (always — admin can review)
    // ============================================================
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
          // @ts-ignore — provider field added in v4.151, may not exist in older schemas
          provider,
        },
      })
      ticketCreated = true
      console.log(`[HELP-CHAT] Ticket created via ${provider}: ${category} — "${optimizedQuery}"`)
    } catch (dbErr: any) {
      console.warn('[HELP-CHAT] Could not create ticket:', dbErr?.message)
    }

    return NextResponse.json({
      response: aiResponse,
      ticketCreated,
      needsHumanSupport,
      provider,
      availableProviders,
    })
  } catch (error: any) {
    console.error('[HELP-CHAT] Error:', error?.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ============================================================
// Helper: Detect category from message text
// ============================================================
function detectCategory(msg: string): string {
  const lower = msg.toLowerCase()
  if (/regist|sign\s*up|create\s*account/.test(lower)) return 'Registration'
  if (/otp|verification\s*code/.test(lower)) return 'OTP'
  if (/pay|razorpay|subscription|recharge|plan/.test(lower)) return 'Payment'
  if (/inventory|stock|product/.test(lower)) return 'Inventory'
  if (/invoice|bill|gst/.test(lower)) return 'Invoice'
  if (/login|password|account|delete/.test(lower)) return 'Account'
  if (/error|bug|crash|not\s*working|broken/.test(lower)) return 'Bug'
  return 'Other'
}

// ============================================================
// Helper: Canned responses when AI is unavailable
// ============================================================
function getCannedResponse(msg: string): string {
  const lower = msg.toLowerCase()
  if (/otp|verification/.test(lower)) {
    return 'If you didn\'t receive an OTP, check the amber banner on your screen — when email/SMS is not configured, the OTP is shown directly there. Also check your spam folder if email was used.'
  }
  if (/payment|razorpay/.test(lower)) {
    return 'If payment is failing with "Authentication failed", the admin needs to verify RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables on Railway. Your query has been forwarded to our support team.'
  }
  if (/plan|recharge|subscription/.test(lower)) {
    return 'We offer 5 plans: 50Hrs ₹150, 100Hrs ₹217, 200Hrs ₹285, 500Hrs ₹493, 1000Hrs ₹562. View-Only users are always free. Recharge from Subscription page.'
  }
  if (/register|sign\s*up/.test(lower)) {
    return 'To register: click "Sign Up" on the login page, enter your details, and use the OTP shown in the amber banner (when email/SMS is not configured). Master mobile 9101555075 can register multiple accounts.'
  }
  return 'I\'m having trouble connecting to the AI service right now. Your query has been forwarded to our support team — they will get back to you soon.'
}
