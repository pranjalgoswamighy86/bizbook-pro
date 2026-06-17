import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'bizbook-pro', timestamp: new Date().toISOString() })
}
