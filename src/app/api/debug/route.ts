import { NextRequest, NextResponse } from 'next/server'
import { requireDebugAccess } from '@/lib/debug-guard'

export async function GET(req: NextRequest) {
  // v6.29.5: was unauthenticated — echoed request headers (cookie recon)
  const guard = await requireDebugAccess(req)
  if (guard instanceof NextResponse) return guard

  return NextResponse.json({
    method: 'GET',
    headers: Object.fromEntries(req.headers.entries()),
    url: req.url,
    timestamp: new Date().toISOString(),
  })
}

export async function POST(req: NextRequest) {
  // v6.29.5: was unauthenticated — echoed request headers + body
  const guard = await requireDebugAccess(req)
  if (guard instanceof NextResponse) return guard

  let body = null
  try {
    body = await req.json()
  } catch {
    body = 'parse error'
  }
  return NextResponse.json({
    method: 'POST',
    headers: Object.fromEntries(req.headers.entries()),
    body,
    url: req.url,
    timestamp: new Date().toISOString(),
  })
}
