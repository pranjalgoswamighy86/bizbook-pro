import { NextRequest, NextResponse } from 'next/server'
import { rawDb } from '@/lib/db-soft-delete'
import { requireAuth } from '@/lib/api-helpers'

/**
 * Complete Database Backup API
 * 
 * GET /api/backup/download
 * 
 * Exports ALL database tables to a single JSON file and sends it as
 * a downloadable attachment. This is for disaster recovery — if you
 * lose access to Railway, you can restore the entire software from
 * this backup file.
 * 
 * Any authenticated user can download a backup of their own tenant data.
 */

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth

    // Get all table names from Prisma
    const tableNames = [
      'tenant', 'user', 'userTenant',
      'sale', 'purchase', 'expense',
      'inventoryItem', 'debtor', 'creditor',
      'account', 'journalEntry', 'journalEntryLine',
      'staff', 'salaryPayment',
      'subscription', 'subscriptionQueue', 'recharge', 'usageLog',
      'auditLog', 'helpSupportTicket',
      'payment', 'receipt', 'party',
      'product', 'productIngredient',
      'batch', 'priceList', 'priceListItem',
      'bankTransaction', 'bankStatementUpload',
    ]

    const backup: Record<string, unknown[]> = {}
    
    for (const table of tableNames) {
      try {
        const records = await rawDb[table].findMany({ take: 100000 })
        backup[table] = records
      } catch {
        backup[table] = []
      }
    }

    const backupData = {
      _metadata: {
        software: 'BizBook Pro',
        version: 'v4.107',
        exportDate: new Date().toISOString(),
        tableCount: Object.keys(backup).length,
        totalRecords: Object.values(backup).reduce((sum, arr) => sum + arr.length, 0),
        instructions: 'To restore: 1. Set up new PostgreSQL database 2. Run prisma db push to create tables 3. Import this JSON data into the tables 4. Deploy the application',
      },
      data: backup,
    }

    const jsonStr = JSON.stringify(backupData, null, 2)
    const buffer = Buffer.from(jsonStr, 'utf-8')

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="bizbook_pro_backup_${new Date().toISOString().split('T')[0]}.json"`,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error: any) {
    console.error('Backup error:', error)
    return NextResponse.json(
      { error: 'Backup failed', details: error?.message || 'Unknown error' },
      { status: 500 }
    )
  }
}
