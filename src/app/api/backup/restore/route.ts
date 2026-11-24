import { NextRequest, NextResponse } from 'next/server'
import { rawDb } from '@/lib/db-soft-delete'
import { verifyPassword } from '@/lib/auth'
import { isSuperAdminEmail } from '@/lib/rbac/enforce-v2'

export const maxDuration = 600
export const dynamic = 'force-dynamic'

const TABLE_ORDER: Array<[string, string]> = [
  ['Tenant', 'tenant'],
  ['User', 'user'],
  ['UserTenant', 'userTenant'],
  ['Party', 'party'],
  ['Product', 'product'],
  ['InventoryItem', 'inventoryItem'],
  ['ProductIngredient', 'productIngredient'],
  ['Sale', 'sale'],
  ['Purchase', 'purchase'],
  ['Expense', 'expense'],
  ['BankTransaction', 'bankTransaction'],
  ['BankStatementUpload', 'bankStatementUpload'],
  ['Staff', 'staff'],
  ['SalaryPayment', 'salaryPayment'],
  ['Payment', 'payment'],
  ['Receipt', 'receipt'],
  ['Debtor', 'debtor'],
  ['Creditor', 'creditor'],
  ['Account', 'account'],
  ['JournalEntry', 'journalEntry'],
  ['JournalEntryLine', 'journalEntryLine'],
  ['Batch', 'batch'],
  ['PriceList', 'priceList'],
  ['PriceListItem', 'priceListItem'],
  ['Subscription', 'subscription'],
  ['SubscriptionQueue', 'subscriptionQueue'],
  ['Recharge', 'recharge'],
  ['UsageLog', 'usageLog'],
  ['AuditLog', 'auditLog'],
  ['HelpSupportTicket', 'helpSupportTicket'],
]

const OWNERSHIP_SELECT: Record<string, Record<string, boolean>> = {
  tenant: { id: true },
  user: { tenantId: true, role: true },
  userTenant: { tenantId: true, isOwner: true },
  party: { tenantId: true },
  product: { tenantId: true },
  productIngredient: { productId: true, inventoryItemId: true },
  inventoryItem: { tenantId: true },
  sale: { tenantId: true },
  purchase: { tenantId: true },
  expense: { tenantId: true },
  bankTransaction: { tenantId: true },
  bankStatementUpload: { tenantId: true },
  staff: { tenantId: true },
  salaryPayment: { tenantId: true },
  payment: { tenantId: true },
  receipt: { tenantId: true },
  debtor: { tenantId: true },
  creditor: { tenantId: true },
  account: { tenantId: true },
  journalEntry: { tenantId: true },
  journalEntryLine: { entryId: true, accountId: true },
  batch: { tenantId: true },
  priceList: { tenantId: true },
  priceListItem: { priceListId: true, inventoryItemId: true },
  subscription: { tenantId: true },
  subscriptionQueue: { tenantId: true },
  recharge: { subscriptionId: true },
  usageLog: { subscriptionId: true },
  auditLog: { tenantId: true },
  helpSupportTicket: { userId: true },
}

const tenantOwnershipCache = new Map<string, Promise<boolean>>()

async function parentBelongsToTenant(model: string, id: unknown, tenantId: string): Promise<boolean> {
  if (typeof id !== 'string' || !id) return false
  const key = `${model}:${id}:${tenantId}`
  let pending = tenantOwnershipCache.get(key)
  if (!pending) {
    pending = (async () => {
      const parent = await (rawDb as any)[model].findUnique({
        where: { id },
        select: { tenantId: true },
      })
      return parent?.tenantId === tenantId
    })()
    tenantOwnershipCache.set(key, pending)
  }
  return pending
}

async function recordBelongsToTenant(model: string, row: any, tenantId: string): Promise<boolean> {
  if (!row || typeof row !== 'object') return false
  if (model === 'tenant') return row.id === tenantId

  const directTenantModels = new Set([
    'user', 'userTenant', 'party', 'product', 'inventoryItem', 'sale', 'purchase',
    'expense', 'bankTransaction', 'bankStatementUpload', 'staff', 'salaryPayment',
    'payment', 'receipt', 'debtor', 'creditor', 'account', 'journalEntry', 'batch',
    'priceList', 'subscription', 'subscriptionQueue', 'auditLog',
  ])
  if (directTenantModels.has(model)) return row.tenantId === tenantId

  if (model === 'productIngredient') {
    const [productOk, inventoryOk] = await Promise.all([
      parentBelongsToTenant('product', row.productId, tenantId),
      parentBelongsToTenant('inventoryItem', row.inventoryItemId, tenantId),
    ])
    return productOk && inventoryOk
  }
  if (model === 'priceListItem') {
    const [priceListOk, inventoryOk] = await Promise.all([
      parentBelongsToTenant('priceList', row.priceListId, tenantId),
      parentBelongsToTenant('inventoryItem', row.inventoryItemId, tenantId),
    ])
    return priceListOk && inventoryOk
  }
  if (model === 'journalEntryLine') {
    const [entryOk, accountOk] = await Promise.all([
      parentBelongsToTenant('journalEntry', row.entryId, tenantId),
      parentBelongsToTenant('account', row.accountId, tenantId),
    ])
    return entryOk && accountOk
  }
  if (model === 'recharge' || model === 'usageLog') {
    return parentBelongsToTenant('subscription', row.subscriptionId, tenantId)
  }
  if (model === 'helpSupportTicket') {
    return parentBelongsToTenant('user', row.userId, tenantId)
  }
  return false
}

function getBackupRows(data: Record<string, unknown>, label: string, model: string): any[] {
  const rows = data[label] ?? data[model]
  return Array.isArray(rows) ? rows : []
}

function cleanRecord(record: Record<string, any>) {
  const cleaned = { ...record }
  for (const relation of [
    '_count', 'tenant', 'user', 'userTenants', 'sales', 'purchases', 'expenses',
    'inventory', 'items', 'ingredients', 'subscription', 'subscriptions', 'entry',
    'account', 'product', 'inventoryItem', 'priceList', 'payments', 'receipts',
    'debtors', 'creditors', 'auditLogs', 'staff',
  ]) {
    delete cleaned[relation]
  }
  return cleaned
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body.email !== 'string' || typeof body.password !== 'string' || !body.email.trim() || !body.password || !body.backupData) {
      return NextResponse.json({ error: 'Email, password, and backupData are required.' }, { status: 400 })
    }

    const email = body.email.trim().toLowerCase()
    const password = body.password
    const backupData = body.backupData
    if (!backupData || backupData._metadata?.software !== 'BizBook Pro' ||
        !backupData.data || typeof backupData.data !== 'object' || Array.isArray(backupData.data)) {
      return NextResponse.json({ error: 'Invalid BizBook Pro backup file.' }, { status: 400 })
    }

    // Authenticate only against the live destination database. Never accept
    // password hashes, user roles or identities from an untrusted backup.
    const currentUser = await rawDb.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: {
        id: true,
        email: true,
        name: true,
        password: true,
        role: true,
        tenantId: true,
        isActive: true,
        isDeleted: true,
      },
    })
    const passwordValid = currentUser ? verifyPassword(password, currentUser.password) : false
    if (!currentUser || !passwordValid || !currentUser.isActive || currentUser.isDeleted) {
      return NextResponse.json({ error: 'Invalid email/password or inactive account.' }, { status: 401 })
    }

    const isPlatformAdmin = isSuperAdminEmail(currentUser.email)
    if (isPlatformAdmin && password === 'admin123') {
      return NextResponse.json({
        error: 'Change the default seeded password before restoring a system-wide backup.',
      }, { status: 403 })
    }

    let tenantId: string | null = null
    if (!isPlatformAdmin) {
      tenantId = currentUser.tenantId
      if (!tenantId) return NextResponse.json({ error: 'This account is not linked to a business.' }, { status: 403 })
      const membership = await rawDb.userTenant.findFirst({
        where: { userId: currentUser.id, tenantId },
        select: { role: true, isOwner: true },
      })
      if (!membership || (membership.role !== 'MAIN_ADMIN' && !membership.isOwner)) {
        return NextResponse.json({ error: 'Only the business administrator can restore business data.' }, { status: 403 })
      }

      const tenantRows = getBackupRows(backupData.data, 'Tenant', 'tenant')
      const backupTenantIds = tenantRows.map(row => row?.id).filter((id): id is string => typeof id === 'string')
      if (!backupTenantIds.includes(tenantId) || backupTenantIds.some(id => id !== tenantId)) {
        return NextResponse.json({
          error: 'This backup does not contain only your current business. Cross-business restore requires a platform administrator.',
        }, { status: 403 })
      }
    }

    const results: Array<{ table: string; imported: number; updated: number; skipped: number; error?: string }> = []
    let totalImported = 0
    let totalUpdated = 0
    let totalSkipped = 0

    for (const [label, model] of TABLE_ORDER) {
      const sourceRows = getBackupRows(backupData.data, label, model)
      let records = sourceRows
      if (tenantId) {
        if (model === 'tenant') {
          records = sourceRows.filter(row => row?.id === tenantId)
        } else if (model === 'productIngredient') {
          const productIds = new Set(getBackupRows(backupData.data, 'Product', 'product')
            .filter(row => row?.tenantId === tenantId).map(row => row.id))
          const inventoryIds = new Set(getBackupRows(backupData.data, 'InventoryItem', 'inventoryItem')
            .filter(row => row?.tenantId === tenantId).map(row => row.id))
          records = sourceRows.filter(row => productIds.has(row?.productId) && inventoryIds.has(row?.inventoryItemId))
        } else if (model === 'priceListItem') {
          const priceListIds = new Set(getBackupRows(backupData.data, 'PriceList', 'priceList')
            .filter(row => row?.tenantId === tenantId).map(row => row.id))
          const inventoryIds = new Set(getBackupRows(backupData.data, 'InventoryItem', 'inventoryItem')
            .filter(row => row?.tenantId === tenantId).map(row => row.id))
          records = sourceRows.filter(row => priceListIds.has(row?.priceListId) && inventoryIds.has(row?.inventoryItemId))
        } else if (model === 'journalEntryLine') {
          const entryIds = new Set(getBackupRows(backupData.data, 'JournalEntry', 'journalEntry')
            .filter(row => row?.tenantId === tenantId).map(row => row.id))
          const accountIds = new Set(getBackupRows(backupData.data, 'Account', 'account')
            .filter(row => row?.tenantId === tenantId).map(row => row.id))
          records = sourceRows.filter(row => entryIds.has(row?.entryId) && accountIds.has(row?.accountId))
        } else if (model === 'recharge' || model === 'usageLog') {
          const subscriptionIds = new Set(getBackupRows(backupData.data, 'Subscription', 'subscription')
            .filter(row => row?.tenantId === tenantId).map(row => row.id))
          records = sourceRows.filter(row => subscriptionIds.has(row?.subscriptionId))
        } else if (model === 'helpSupportTicket') {
          const userIds = new Set(getBackupRows(backupData.data, 'User', 'user')
            .filter(row => row?.tenantId === tenantId).map(row => row.id))
          records = sourceRows.filter(row => userIds.has(row?.userId))
        } else {
          records = sourceRows.filter(row => row?.tenantId === tenantId)
        }
      }

      let imported = 0
      let updated = 0
      let skipped = Math.max(0, sourceRows.length - records.length)
      totalSkipped += skipped
      let errorMsg: string | undefined

      for (const record of records) {
        try {
          if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.id !== 'string' || !record.id) {
            skipped++
            totalSkipped++
            continue
          }
          if (tenantId && !(await recordBelongsToTenant(model, record, tenantId))) {
            skipped++
            totalSkipped++
            continue
          }

          const delegate = (rawDb as any)[model]
          const existing = await delegate.findUnique({
            where: { id: record.id },
            select: { id: true, ...(OWNERSHIP_SELECT[model] || {}) },
          })

          if (tenantId && existing && !(await recordBelongsToTenant(model, existing, tenantId))) {
            // A crafted backup must not overwrite a record already owned by
            // another business, even if its payload changes the tenant fields.
            skipped++
            continue
          }

          const nextRecord = cleanRecord(record)
          if (tenantId && model === 'user') {
            if (['SUPER_ADMIN', 'INFRASTRUCTURE_OWNER_ADMIN'].includes(String(nextRecord.role || '').toUpperCase())) {
              nextRecord.role = existing?.role || 'DATA_ENTRY'
            }
          }
          if (tenantId && model === 'userTenant') {
            const allowedRoles = ['MAIN_ADMIN', 'JUNIOR_ADMIN', 'DATA_ENTRY', 'VIEW_ONLY']
            if (!allowedRoles.includes(String(nextRecord.role || '').toUpperCase())) nextRecord.role = 'DATA_ENTRY'
            // Tenant restore cannot create or transfer ownership.
            nextRecord.isOwner = existing?.isOwner === true
          }

          await delegate.upsert({
            where: { id: record.id },
            create: nextRecord,
            update: nextRecord,
          })

          if (existing) {
            updated++
            totalUpdated++
          } else {
            imported++
            totalImported++
          }
        } catch (error) {
          skipped++
          totalSkipped++
          if (!errorMsg) errorMsg = error instanceof Error ? error.message.slice(0, 200) : 'Unknown error'
        }
      }

      results.push({ table: label, imported, updated, skipped, error: errorMsg })
    }

    try {
      if (currentUser.tenantId) {
        await rawDb.auditLog.create({
          data: {
            tenantId: currentUser.tenantId,
            userId: currentUser.id,
            userName: currentUser.name,
            action: 'DATABASE_RESTORE',
            entityType: 'Backup',
            entityId: null,
            entityName: `Restored ${totalImported + totalUpdated} ${tenantId ? 'business' : 'system'} records`,
            changes: JSON.stringify({
              exportDate: backupData._metadata.exportDate,
              exportMethod: backupData._metadata.exportMethod,
              imported: totalImported,
              updated: totalUpdated,
              skipped: totalSkipped,
              scope: tenantId ? 'tenant' : 'global',
            }),
          },
        })
      }
    } catch {
      // Preserve the restore result if audit logging fails.
    }

    return NextResponse.json({
      success: true,
      message: `Restore complete. ${totalImported} records imported, ${totalUpdated} updated, ${totalSkipped} skipped.`,
      summary: {
        backupDate: backupData._metadata.exportDate,
        backupMethod: backupData._metadata.exportMethod,
        scope: tenantId ? 'tenant' : 'global',
        recordsImported: totalImported,
        recordsUpdated: totalUpdated,
        recordsSkipped: totalSkipped,
      },
      details: results.filter(row => row.imported > 0 || row.updated > 0 || row.skipped > 0 || row.error),
    })
  } catch (error) {
    console.error('[RESTORE] Error:', error)
    return NextResponse.json({ error: 'Restore failed. Validate the backup and your administrator permissions, then try again.' }, { status: 500 })
  }
}
