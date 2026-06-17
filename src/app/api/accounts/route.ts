import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'

// Chart of Accounts CRUD API
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    if (!tenantId) {
      return NextResponse.json({ error: 'No business selected' }, { status: 400 })
    }

    // Validate tenant
    const tenantExists = await db.tenant.findUnique({ where: { id: tenantId } })
    if (!tenantExists) {
      return NextResponse.json({ error: 'Invalid business session' }, { status: 401 })
    }

    if (action === 'create') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { accountCode, name, type, description, parentId } = body
      if (!accountCode || !name || !type) {
        return NextResponse.json({ error: 'Account code, name, and type are required' }, { status: 400 })
      }
      const validTypes = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense']
      if (!validTypes.includes(type)) {
        return NextResponse.json({ error: `Type must be one of: ${validTypes.join(', ')}` }, { status: 400 })
      }

      // Check for duplicate account code within tenant
      const existing = await db.account.findFirst({ where: { accountCode, tenantId } })
      if (existing) {
        return NextResponse.json({ error: `Account code ${accountCode} already exists` }, { status: 409 })
      }

      const account = await db.account.create({
        data: {
          accountCode,
          name,
          type,
          description: description || null,
          parentId: parentId || null,
          tenantId,
        }
      })
      return NextResponse.json({ account })
    }

    if (action === 'update') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id, data } = body
      if (!id) return NextResponse.json({ error: 'Account ID required' }, { status: 400 })

      // If changing accountCode, check for duplicate
      if (data.accountCode) {
        const existing = await db.account.findFirst({
          where: { accountCode: data.accountCode, tenantId, NOT: { id } }
        })
        if (existing) {
          return NextResponse.json({ error: `Account code ${data.accountCode} already exists` }, { status: 409 })
        }
      }

      const account = await db.account.update({
        where: { id },
        data: {
          ...(data.accountCode ? { accountCode: data.accountCode } : {}),
          ...(data.name ? { name: data.name } : {}),
          ...(data.type ? { type: data.type } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
        }
      })
      return NextResponse.json({ account })
    }

    if (action === 'delete') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id } = body
      if (!id) return NextResponse.json({ error: 'Account ID required' }, { status: 400 })

      // Check if account has any journal entry lines
      const lineCount = await db.journalEntryLine.count({ where: { accountId: id } })
      if (lineCount > 0) {
        return NextResponse.json({
          error: `Cannot delete account — it has ${lineCount} journal entry line(s). Deactivate it instead.`
        }, { status: 400 })
      }

      // Check for child accounts
      const childCount = await db.account.count({ where: { parentId: id } })
      if (childCount > 0) {
        return NextResponse.json({
          error: `Cannot delete account — it has ${childCount} sub-account(s). Remove or reassign them first.`
        }, { status: 400 })
      }

      await db.account.delete({ where: { id } })
      return NextResponse.json({ success: true })
    }

    if (action === 'list') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const accounts = await db.account.findMany({
        where: { tenantId },
        include: {
          parent: { select: { id: true, name: true, accountCode: true } },
          children: { select: { id: true, name: true, accountCode: true, isActive: true } },
          _count: { select: { children: true } }
        },
        orderBy: [{ type: 'asc' }, { accountCode: 'asc' }],
      })
      return NextResponse.json({ accounts })
    }

    if (action === 'seed-defaults') {
      // Seed a standard Indian Chart of Accounts for a new tenant
      const existingCount = await db.account.count({ where: { tenantId } })
      if (existingCount > 0) {
        return NextResponse.json({ error: 'Chart of accounts already exists for this business', count: existingCount }, { status: 400 })
      }

      const defaultAccounts = [
        // Assets
        { accountCode: '10000', name: 'Assets', type: 'Asset', description: 'All assets' },
        { accountCode: '10100', name: 'Cash', type: 'Asset', description: 'Cash on hand' },
        { accountCode: '10200', name: 'Bank Account', type: 'Asset', description: 'Bank balances' },
        { accountCode: '10300', name: 'Accounts Receivable', type: 'Asset', description: 'Money owed by customers' },
        { accountCode: '10400', name: 'Inventory', type: 'Asset', description: 'Stock in hand' },
        { accountCode: '10500', name: 'Prepaid Expenses', type: 'Asset', description: 'Advance payments' },
        { accountCode: '10600', name: 'Fixed Assets', type: 'Asset', description: 'Property, plant, equipment' },
        // Liabilities
        { accountCode: '20000', name: 'Liabilities', type: 'Liability', description: 'All liabilities' },
        { accountCode: '20100', name: 'Accounts Payable', type: 'Liability', description: 'Money owed to suppliers' },
        { accountCode: '20200', name: 'GST Payable', type: 'Liability', description: 'GST collected but not yet remitted' },
        { accountCode: '20300', name: 'TDS Payable', type: 'Liability', description: 'Tax deducted at source' },
        { accountCode: '20400', name: 'Loans', type: 'Liability', description: 'Outstanding loans' },
        { accountCode: '20500', name: 'Accrued Expenses', type: 'Liability', description: 'Expenses incurred but not yet paid' },
        // Equity
        { accountCode: '30000', name: 'Equity', type: 'Equity', description: "Owner's equity" },
        { accountCode: '30100', name: 'Capital', type: 'Equity', description: 'Owner capital contributions' },
        { accountCode: '30200', name: 'Retained Earnings', type: 'Equity', description: 'Accumulated profits' },
        { accountCode: '30300', name: 'Drawings', type: 'Equity', description: 'Owner withdrawals' },
        // Revenue
        { accountCode: '40000', name: 'Revenue', type: 'Revenue', description: 'All income' },
        { accountCode: '40100', name: 'Sales Revenue', type: 'Revenue', description: 'Income from sales of goods/services' },
        { accountCode: '40200', name: 'Other Income', type: 'Revenue', description: 'Non-operating income' },
        // Expenses
        { accountCode: '50000', name: 'Expenses', type: 'Expense', description: 'All expenses' },
        { accountCode: '50100', name: 'Cost of Goods Sold', type: 'Expense', description: 'Direct cost of products sold' },
        { accountCode: '50200', name: 'Purchase Expenses', type: 'Expense', description: 'Purchases of goods for resale' },
        { accountCode: '50300', name: 'Rent Expense', type: 'Expense', description: 'Office/warehouse rent' },
        { accountCode: '50400', name: 'Salary Expense', type: 'Expense', description: 'Employee salaries' },
        { accountCode: '50500', name: 'Utility Expenses', type: 'Expense', description: 'Electricity, water, internet' },
        { accountCode: '50600', name: 'GST Input Credit', type: 'Expense', description: 'GST paid on purchases (recoverable)' },
        { accountCode: '50700', name: 'Office Supplies', type: 'Expense', description: 'Stationery, consumables' },
        { accountCode: '50800', name: 'Travel Expense', type: 'Expense', description: 'Business travel' },
        { accountCode: '50900', name: 'Depreciation', type: 'Expense', description: 'Asset depreciation' },
        { accountCode: '51000', name: 'Bank Charges', type: 'Expense', description: 'Banking fees and interest' },
        { accountCode: '51100', name: 'Miscellaneous Expense', type: 'Expense', description: 'Other expenses' },
      ]

      const accounts = await db.account.createMany({
        data: defaultAccounts.map(a => ({ ...a, tenantId })),
      })

      return NextResponse.json({ created: accounts.count, message: 'Default Chart of Accounts seeded' })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: unknown) {
    console.error('Accounts error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
