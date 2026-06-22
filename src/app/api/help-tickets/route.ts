/**
 * Help Tickets Admin API (v4.63) — Super Admin only
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuth } from '@/lib/api-helpers'

const SUPER_ADMIN_EMAILS = ['admin@bizbook.pro', 'pranjalgoswamighy86@gmail.com']

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth

    const user = await db.user.findUnique({ where: { id: auth.userId } })
    if (!user || !SUPER_ADMIN_EMAILS.includes(user.email.toLowerCase())) {
      return NextResponse.json({ error: 'Super Admin access required' }, { status: 403 })
    }

    const body = await req.json()
    const { action } = body

    if (action === 'list') {
      const tickets = await db.helpSupportTicket.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
      return NextResponse.json({ success: true, tickets })
    }

    if (action === 'respond') {
      const { ticketId, adminResponse } = body
      if (!ticketId || !adminResponse?.trim()) {
        return NextResponse.json({ error: 'ticketId and adminResponse required' }, { status: 400 })
      }
      await db.helpSupportTicket.update({
        where: { id: ticketId },
        data: {
          adminResponse: adminResponse.trim(),
          adminRespondedBy: auth.userId,
          adminRespondedAt: new Date(),
          status: 'RESOLVED',
        },
      })
      return NextResponse.json({ success: true, message: 'Response sent' })
    }

    if (action === 'close') {
      const { ticketId } = body
      await db.helpSupportTicket.update({
        where: { id: ticketId },
        data: { status: 'RESOLVED' },
      })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: any) {
    console.error('[HELP-TICKETS] Error:', error?.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
