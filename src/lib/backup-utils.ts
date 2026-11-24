import { rawDb } from '@/lib/db-soft-delete'

type BackupTable = {
  model: string
  label: string
  tenantWhere?: (tenantId: string, userIds: string[]) => Record<string, unknown>
}

// PasswordReset is intentionally excluded: its rows contain live/recent OTPs.
const BACKUP_TABLES: BackupTable[] = [
  { model: 'tenant', label: 'Tenant', tenantWhere: (tenantId) => ({ id: tenantId }) },
  { model: 'user', label: 'User', tenantWhere: (tenantId) => ({ tenantId }) },
  { model: 'userTenant', label: 'UserTenant', tenantWhere: (tenantId) => ({ tenantId }) },
  { model: 'party', label: 'Party', tenantWhere: (tenantId) => ({ tenantId }) },
  { model: 'product', label: 'Product', tenantWhere: (tenantId) => ({ tenantId }) },
  {
    model: 'productIngredient',
    label: 'ProductIngredient',
    tenantWhere: (tenantId) => ({
      product: { is: { tenantId } },
      inventoryItem: { is: { tenantId } },
    }),
  },
  { model: 'inventoryItem', label: 'InventoryItem', tenantWhere: (tenantId) => ({ tenantId }) },
  { model: 'sale', label: 'Sale', tenantWhere: (tenantId) => ({ tenantId }) },
  { model: 'purchase', label: 'Purchase', tenantWhere: (tenantId) => ({ tenantId }) },
  { model: 'expense', label: 'Expense', tenantWhere: (tenantId) => ({ tenantId }) },
  { model: 'bankTransaction', label: 'BankTransaction', tenantWhere: (tenantId) => ({ tenantId }) },
  { model: 'bankStatementUpload', label: 'BankStatementUpload', tenantWhere: (tenantId) => ({ tenantId }) },
  { model: 'staff', label: 'Staff', tenantWhere: (tenantId) => ({ tenantId }) },
  { model: 'salaryPayment', label: 'SalaryPayment', tenantWhere: (tenantId) => ({ tenantId }) },
  { model: 'payment', label: 'Payment', tenantWhere: (tenantId) => ({ tenantId }) },
  { model: 'receipt', label: 'Receipt', tenantWhere: (tenantId) => ({ tenantId }) },
  { model: 'debtor', label: 'Debtor', tenantWhere: (tenantId) => ({ tenantId }) },
  { model: 'creditor', label: 'Creditor', tenantWhere: (tenantId) => ({ tenantId }) },
  { model: 'account', label: 'Account', tenantWhere: (tenantId) => ({ tenantId }) },
  { model: 'journalEntry', label: 'JournalEntry', tenantWhere: (tenantId) => ({ tenantId }) },
  {
    model: 'journalEntryLine',
    label: 'JournalEntryLine',
    tenantWhere: (tenantId) => ({
      entry: { is: { tenantId } },
      account: { is: { tenantId } },
    }),
  },
  { model: 'batch', label: 'Batch', tenantWhere: (tenantId) => ({ tenantId }) },
  { model: 'priceList', label: 'PriceList', tenantWhere: (tenantId) => ({ tenantId }) },
  {
    model: 'priceListItem',
    label: 'PriceListItem',
    tenantWhere: (tenantId) => ({
      priceList: { is: { tenantId } },
      inventoryItem: { is: { tenantId } },
    }),
  },
  { model: 'subscription', label: 'Subscription', tenantWhere: (tenantId) => ({ tenantId }) },
  { model: 'subscriptionQueue', label: 'SubscriptionQueue', tenantWhere: (tenantId) => ({ tenantId }) },
  {
    model: 'recharge',
    label: 'Recharge',
    tenantWhere: (tenantId) => ({ subscription: { is: { tenantId } } }),
  },
  {
    model: 'usageLog',
    label: 'UsageLog',
    tenantWhere: (tenantId) => ({ subscription: { is: { tenantId } } }),
  },
  { model: 'auditLog', label: 'AuditLog', tenantWhere: (tenantId) => ({ tenantId }) },
  {
    model: 'helpSupportTicket',
    label: 'HelpSupportTicket',
    tenantWhere: (_tenantId, userIds) => ({ userId: { in: userIds } }),
  },
]

/**
 * Creates a portable backup in the PascalCase shape expected by the restore
 * endpoint. A null tenantId is reserved for authenticated platform admins.
 */
export async function buildBackupRecords(tenantId: string | null, take = 100000) {
  const userIds = tenantId
    ? (await rawDb.user.findMany({ where: { tenantId }, select: { id: true } })).map((user) => user.id)
    : []

  const data: Record<string, unknown[]> = {}
  const tableErrors: Array<{ table: string; error: string }> = []

  for (const table of BACKUP_TABLES) {
    try {
      const where = tenantId
        ? table.tenantWhere?.(tenantId, userIds) ?? {}
        : undefined
      const rows = await (rawDb as any)[table.model].findMany({
        ...(where ? { where } : {}),
        take,
      })
      data[table.label] = rows
    } catch (error) {
      data[table.label] = []
      tableErrors.push({
        table: table.label,
        error: error instanceof Error ? error.message.slice(0, 200) : 'Unknown error',
      })
    }
  }

  return {
    data,
    tableErrors,
    totalRecords: Object.values(data).reduce((total, rows) => total + rows.length, 0),
  }
}
