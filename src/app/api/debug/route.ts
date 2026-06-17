import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  return NextResponse.json({
    method: 'GET',
    headers: Object.fromEntries(req.headers.entries()),
    url: req.url,
    timestamp: new Date().toISOString(),
  })
}

export async function POST(req: NextRequest) {
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
