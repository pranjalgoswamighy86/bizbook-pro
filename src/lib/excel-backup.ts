/**
 * BizBook Pro - Comprehensive Excel Backup System
 *
 * CORE FEATURE: This module is permanently locked into the software.
 * It provides automatic Excel backup generation after every data save,
 * ensuring zero data loss probability for users.
 *
 * Design:
 * - Multi-sheet Excel file with ALL data models
 * - Auto-triggered after every create/update/delete operation
 * - Debounced (max once per 30 seconds per tenant)
 * - Users can download the latest backup anytime
 * - Users can upload Excel files to restore/import data
 *
 * DO NOT REMOVE THIS MODULE - It is a core data protection feature.
 */

import { db } from './db'

// ============================================================
// Types
// ============================================================

interface BackupMeta {
  version: string
  app: string
  exportedAt: string
  company: string
  tenantId: string
  totalRecords: number
  sheets: string[]
}

interface SheetConfig {
  name: string
  header: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getData: (tenantId: string) => Promise<any[]>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mapRow: (row: any) => Record<string, unknown>
}

// ============================================================
// Sheet Definitions - ALL data models included
// ============================================================

const SHEET_CONFIGS: SheetConfig[] = [
  {
    name: 'Parties',
    header: ['id', 'name', 'type', 'phone', 'email', 'address', 'gstNumber', 'panNumber', 'openingBalance', 'currentBalance', 'isDeleted', 'deletedAt', 'createdAt', 'updatedAt'],
    getData: (tid) => db.party.findMany({ where: { tenantId: tid } }),
    mapRow: (r) => ({
      id: r.id, name: r.name, type: r.type, phone: r.phone || '', email: r.email || '',
      address: r.address || '', gstNumber: r.gstNumber || '', panNumber: r.panNumber || '',
      openingBalance: r.openingBalance, currentBalance: r.currentBalance,
      isDeleted: r.isDeleted ? 'Yes' : 'No', deletedAt: fmtDate(r.deletedAt),
      createdAt: fmtDate(r.createdAt), updatedAt: fmtDate(r.updatedAt),
    }),
  },
  {
    name: 'Inventory',
    header: ['id', 'name', 'sku', 'barcode', 'hsnCode', 'unit', 'category', 'brand', 'itemType', 'purchasePrice', 'salePrice', 'mrp', 'openingStock', 'currentStock', 'minStock', 'gstRate', 'value', 'isDeleted', 'deletedAt', 'createdAt', 'updatedAt'],
    getData: (tid) => db.inventoryItem.findMany({ where: { tenantId: tid } }),
    mapRow: (r) => ({
      id: r.id, name: r.name, sku: r.sku || '', barcode: r.barcode || '', hsnCode: r.hsnCode || '',
      unit: r.unit, category: r.category || '', brand: r.brand || '', itemType: r.itemType,
      purchasePrice: r.purchasePrice, salePrice: r.salePrice, mrp: r.mrp || 0,
      openingStock: r.openingStock, currentStock: r.currentStock, minStock: r.minStock,
      gstRate: r.gstRate, value: r.value,
      isDeleted: r.isDeleted ? 'Yes' : 'No', deletedAt: fmtDate(r.deletedAt),
      createdAt: fmtDate(r.createdAt), updatedAt: fmtDate(r.updatedAt),
    }),
  },
  {
    name: 'Products',
    header: ['id', 'name', 'description', 'sku', 'category', 'salePrice', 'gstRate', 'isActive', 'isDeleted', 'deletedAt', 'createdAt', 'updatedAt'],
    getData: (tid) => db.product.findMany({ where: { tenantId: tid } }),
    mapRow: (r) => ({
      id: r.id, name: r.name, description: r.description || '', sku: r.sku || '',
      category: r.category || '', salePrice: r.salePrice, gstRate: r.gstRate,
      isActive: r.isActive ? 'Yes' : 'No',
      isDeleted: r.isDeleted ? 'Yes' : 'No', deletedAt: fmtDate(r.deletedAt),
      createdAt: fmtDate(r.createdAt), updatedAt: fmtDate(r.updatedAt),
    }),
  },
  {
    name: 'ProductIngredients',
    header: ['id', 'productId', 'inventoryItemId', 'quantity', 'unit', 'notes', 'createdAt', 'updatedAt'],
    getData: (tid) => db.productIngredient.findMany({
      where: { product: { tenantId: tid } },
      include: { product: { select: { name: true } }, inventoryItem: { select: { name: true } } }
    }),
    mapRow: (r) => ({
      id: r.id, productId: r.productId, productName: r.product?.name || '',
      inventoryItemId: r.inventoryItemId, inventoryItemName: r.inventoryItem?.name || '',
      quantity: r.quantity, unit: r.unit, notes: r.notes || '',
      createdAt: fmtDate(r.createdAt), updatedAt: fmtDate(r.updatedAt),
    }),
  },
  {
    name: 'Sales',
    header: ['id', 'invoiceNumber', 'date', 'partyName', 'partyAddress', 'partyGst', 'items', 'subtotal', 'gstAmount', 'totalAmount', 'invoiceType', 'invoiceStatus', 'paymentStatus', 'amountReceived', 'amountPaid', 'notes', 'einvoiceIrn', 'einvoiceAckNo', 'einvoiceAckDate', 'einvoiceStatus', 'isDeleted', 'deletedAt', 'createdAt', 'updatedAt'],
    getData: (tid) => db.sale.findMany({ where: { tenantId: tid } }),
    mapRow: (r) => ({
      id: r.id, invoiceNumber: r.invoiceNumber, date: fmtDate(r.date), partyName: r.partyName,
      partyAddress: r.partyAddress || '', partyGst: r.partyGst || '', items: r.items,
      subtotal: r.subtotal, gstAmount: r.gstAmount, totalAmount: r.totalAmount,
      invoiceType: r.invoiceType, invoiceStatus: r.invoiceStatus, paymentStatus: r.paymentStatus,
      amountReceived: r.amountReceived, amountPaid: r.amountPaid, notes: r.notes || '',
      einvoiceIrn: r.einvoiceIrn || '', einvoiceAckNo: r.einvoiceAckNo || '',
      einvoiceAckDate: r.einvoiceAckDate || '', einvoiceStatus: r.einvoiceStatus,
      isDeleted: r.isDeleted ? 'Yes' : 'No', deletedAt: fmtDate(r.deletedAt),
      createdAt: fmtDate(r.createdAt), updatedAt: fmtDate(r.updatedAt),
    }),
  },
  {
    name: 'Purchases',
    header: ['id', 'invoiceNumber', 'date', 'partyName', 'partyAddress', 'partyGst', 'items', 'subtotal', 'gstAmount', 'totalAmount', 'paymentStatus', 'amountPaid', 'notes', 'einvoiceIrn', 'einvoiceAckNo', 'einvoiceAckDate', 'einvoiceStatus', 'isDeleted', 'deletedAt', 'createdAt', 'updatedAt'],
    getData: (tid) => db.purchase.findMany({ where: { tenantId: tid } }),
    mapRow: (r) => ({
      id: r.id, invoiceNumber: r.invoiceNumber, date: fmtDate(r.date), partyName: r.partyName,
      partyAddress: r.partyAddress || '', partyGst: r.partyGst || '', items: r.items,
      subtotal: r.subtotal, gstAmount: r.gstAmount, totalAmount: r.totalAmount,
      paymentStatus: r.paymentStatus, amountPaid: r.amountPaid, notes: r.notes || '',
      einvoiceIrn: r.einvoiceIrn || '', einvoiceAckNo: r.einvoiceAckNo || '',
      einvoiceAckDate: r.einvoiceAckDate || '', einvoiceStatus: r.einvoiceStatus,
      isDeleted: r.isDeleted ? 'Yes' : 'No', deletedAt: fmtDate(r.deletedAt),
      createdAt: fmtDate(r.createdAt), updatedAt: fmtDate(r.updatedAt),
    }),
  },
  {
    name: 'Expenses',
    header: ['id', 'date', 'category', 'description', 'amount', 'paymentMode', 'reference', 'notes', 'isDeleted', 'deletedAt', 'createdAt', 'updatedAt'],
    getData: (tid) => db.expense.findMany({ where: { tenantId: tid } }),
    mapRow: (r) => ({
      id: r.id, date: fmtDate(r.date), category: r.category, description: r.description,
      amount: r.amount, paymentMode: r.paymentMode, reference: r.reference || '', notes: r.notes || '',
      isDeleted: r.isDeleted ? 'Yes' : 'No', deletedAt: fmtDate(r.deletedAt),
      createdAt: fmtDate(r.createdAt), updatedAt: fmtDate(r.updatedAt),
    }),
  },
  {
    name: 'Payments',
    header: ['id', 'date', 'partyName', 'amount', 'paymentMode', 'reference', 'purpose', 'invoiceRef', 'notes', 'isDeleted', 'deletedAt', 'createdAt', 'updatedAt'],
    getData: (tid) => db.payment.findMany({ where: { tenantId: tid } }),
    mapRow: (r) => ({
      id: r.id, date: fmtDate(r.date), partyName: r.partyName, amount: r.amount,
      paymentMode: r.paymentMode, reference: r.reference || '', purpose: r.purpose || '',
      invoiceRef: r.invoiceRef || '', notes: r.notes || '',
      isDeleted: r.isDeleted ? 'Yes' : 'No', deletedAt: fmtDate(r.deletedAt),
      createdAt: fmtDate(r.createdAt), updatedAt: fmtDate(r.updatedAt),
    }),
  },
  {
    name: 'Receipts',
    header: ['id', 'date', 'partyName', 'amount', 'paymentMode', 'reference', 'purpose', 'invoiceRef', 'notes', 'isDeleted', 'deletedAt', 'createdAt', 'updatedAt'],
    getData: (tid) => db.receipt.findMany({ where: { tenantId: tid } }),
    mapRow: (r) => ({
      id: r.id, date: fmtDate(r.date), partyName: r.partyName, amount: r.amount,
      paymentMode: r.paymentMode, reference: r.reference || '', purpose: r.purpose || '',
      invoiceRef: r.invoiceRef || '', notes: r.notes || '',
      isDeleted: r.isDeleted ? 'Yes' : 'No', deletedAt: fmtDate(r.deletedAt),
      createdAt: fmtDate(r.createdAt), updatedAt: fmtDate(r.updatedAt),
    }),
  },
  {
    name: 'BankTransactions',
    header: ['id', 'date', 'description', 'reference', 'deposit', 'withdrawal', 'balance', 'category', 'bankName', 'accountNumber', 'isReconciled', 'isDeleted', 'deletedAt', 'createdAt', 'updatedAt'],
    getData: (tid) => db.bankTransaction.findMany({ where: { tenantId: tid } }),
    mapRow: (r) => ({
      id: r.id, date: fmtDate(r.date), description: r.description, reference: r.reference || '',
      deposit: r.deposit, withdrawal: r.withdrawal, balance: r.balance,
      category: r.category || '', bankName: r.bankName || '', accountNumber: r.accountNumber || '',
      isReconciled: r.isReconciled ? 'Yes' : 'No',
      isDeleted: r.isDeleted ? 'Yes' : 'No', deletedAt: fmtDate(r.deletedAt),
      createdAt: fmtDate(r.createdAt), updatedAt: fmtDate(r.updatedAt),
    }),
  },
  {
    name: 'Staff',
    header: ['id', 'name', 'phone', 'email', 'role', 'department', 'salary', 'joinDate', 'address', 'aadhaar', 'pan', 'fingerprintId', 'isActive', 'isDeleted', 'deletedAt', 'createdAt', 'updatedAt'],
    getData: (tid) => db.staff.findMany({ where: { tenantId: tid } }),
    mapRow: (r) => ({
      id: r.id, name: r.name, phone: r.phone || '', email: r.email || '',
      role: r.role || '', department: r.department || '', salary: r.salary,
      joinDate: fmtDate(r.joinDate), address: r.address || '', aadhaar: r.aadhaar || '',
      pan: r.pan || '', fingerprintId: r.fingerprintId || '',
      isActive: r.isActive ? 'Yes' : 'No',
      isDeleted: r.isDeleted ? 'Yes' : 'No', deletedAt: fmtDate(r.deletedAt),
      createdAt: fmtDate(r.createdAt), updatedAt: fmtDate(r.updatedAt),
    }),
  },
  {
    name: 'SalaryPayments',
    header: ['id', 'staffId', 'staffName', 'month', 'amount', 'paidDate', 'paymentMode', 'status', 'notes', 'isDeleted', 'deletedAt', 'createdAt', 'updatedAt'],
    getData: (tid) => db.salaryPayment.findMany({
      where: { tenantId: tid },
      include: { staff: { select: { name: true } } }
    }),
    mapRow: (r) => ({
      id: r.id, staffId: r.staffId, staffName: r.staff?.name || '',
      month: r.month, amount: r.amount, paidDate: fmtDate(r.paidDate),
      paymentMode: r.paymentMode, status: r.status, notes: r.notes || '',
      isDeleted: r.isDeleted ? 'Yes' : 'No', deletedAt: fmtDate(r.deletedAt),
      createdAt: fmtDate(r.createdAt), updatedAt: fmtDate(r.updatedAt),
    }),
  },
  {
    name: 'Debtors',
    header: ['id', 'name', 'phone', 'email', 'address', 'gstNumber', 'openingBalance', 'currentBalance', 'isDeleted', 'deletedAt', 'createdAt', 'updatedAt'],
    getData: (tid) => db.debtor.findMany({ where: { tenantId: tid } }),
    mapRow: (r) => ({
      id: r.id, name: r.name, phone: r.phone || '', email: r.email || '',
      address: r.address || '', gstNumber: r.gstNumber || '',
      openingBalance: r.openingBalance, currentBalance: r.currentBalance,
      isDeleted: r.isDeleted ? 'Yes' : 'No', deletedAt: fmtDate(r.deletedAt),
      createdAt: fmtDate(r.createdAt), updatedAt: fmtDate(r.updatedAt),
    }),
  },
  {
    name: 'Creditors',
    header: ['id', 'name', 'phone', 'email', 'address', 'gstNumber', 'openingBalance', 'currentBalance', 'sourceType', 'sourceId', 'isDeleted', 'deletedAt', 'createdAt', 'updatedAt'],
    getData: (tid) => db.creditor.findMany({ where: { tenantId: tid } }),
    mapRow: (r) => ({
      id: r.id, name: r.name, phone: r.phone || '', email: r.email || '',
      address: r.address || '', gstNumber: r.gstNumber || '',
      openingBalance: r.openingBalance, currentBalance: r.currentBalance,
      sourceType: r.sourceType, sourceId: r.sourceId || '',
      isDeleted: r.isDeleted ? 'Yes' : 'No', deletedAt: fmtDate(r.deletedAt),
      createdAt: fmtDate(r.createdAt), updatedAt: fmtDate(r.updatedAt),
    }),
  },
  {
    name: 'Accounts',
    header: ['id', 'accountCode', 'name', 'type', 'description', 'isActive', 'parentId', 'createdAt', 'updatedAt'],
    getData: (tid) => db.account.findMany({ where: { tenantId: tid } }),
    mapRow: (r) => ({
      id: r.id, accountCode: r.accountCode, name: r.name, type: r.type,
      description: r.description || '', isActive: r.isActive ? 'Yes' : 'No',
      parentId: r.parentId || '',
      createdAt: fmtDate(r.createdAt), updatedAt: fmtDate(r.updatedAt),
    }),
  },
  {
    name: 'JournalEntries',
    header: ['id', 'entryDate', 'reference', 'description', 'isPosted', 'sourceType', 'sourceId', 'createdBy', 'createdAt', 'updatedAt'],
    getData: (tid) => db.journalEntry.findMany({ where: { tenantId: tid } }),
    mapRow: (r) => ({
      id: r.id, entryDate: fmtDate(r.entryDate), reference: r.reference || '',
      description: r.description, isPosted: r.isPosted ? 'Yes' : 'No',
      sourceType: r.sourceType || '', sourceId: r.sourceId || '',
      createdBy: r.createdBy || '',
      createdAt: fmtDate(r.createdAt), updatedAt: fmtDate(r.updatedAt),
    }),
  },
  {
    name: 'JournalEntryLines',
    header: ['id', 'entryId', 'accountId', 'accountCode', 'accountName', 'debit', 'credit', 'description', 'createdAt', 'updatedAt'],
    getData: (tid) => db.journalEntryLine.findMany({
      where: { entry: { tenantId: tid } },
      include: { account: { select: { accountCode: true, name: true } } }
    }),
    mapRow: (r) => ({
      id: r.id, entryId: r.entryId, accountId: r.accountId,
      accountCode: r.account?.accountCode || '', accountName: r.account?.name || '',
      debit: r.debit, credit: r.credit, description: r.description || '',
      createdAt: fmtDate(r.createdAt), updatedAt: fmtDate(r.updatedAt),
    }),
  },
  {
    name: 'Batches',
    header: ['id', 'inventoryItemId', 'itemNme', 'batchNumber', 'manufacturingDate', 'expiryDate', 'quantity', 'supplier', 'notes', 'isActive', 'createdAt', 'updatedAt'],
    getData: (tid) => db.batch.findMany({
      where: { tenantId: tid },
      include: { inventoryItem: { select: { name: true } } }
    }),
    mapRow: (r) => ({
      id: r.id, inventoryItemId: r.inventoryItemId, itemName: r.inventoryItem?.name || '',
      batchNumber: r.batchNumber, manufacturingDate: fmtDate(r.manufacturingDate),
      expiryDate: fmtDate(r.expiryDate), quantity: r.quantity,
      supplier: r.supplier || '', notes: r.notes || '',
      isActive: r.isActive ? 'Yes' : 'No',
      createdAt: fmtDate(r.createdAt), updatedAt: fmtDate(r.updatedAt),
    }),
  },
  {
    name: 'PriceLists',
    header: ['id', 'name', 'description', 'isDefault', 'isActive', 'createdAt', 'updatedAt'],
    getData: (tid) => db.priceList.findMany({ where: { tenantId: tid } }),
    mapRow: (r) => ({
      id: r.id, name: r.name, description: r.description || '',
      isDefault: r.isDefault ? 'Yes' : 'No', isActive: r.isActive ? 'Yes' : 'No',
      createdAt: fmtDate(r.createdAt), updatedAt: fmtDate(r.updatedAt),
    }),
  },
  {
    name: 'PriceListItems',
    header: ['id', 'priceListId', 'priceListName', 'inventoryItemId', 'itemName', 'price', 'createdAt', 'updatedAt'],
    getData: (tid) => db.priceListItem.findMany({
      where: { priceList: { tenantId: tid } },
      include: { priceList: { select: { name: true } }, inventoryItem: { select: { name: true } } }
    }),
    mapRow: (r) => ({
      id: r.id, priceListId: r.priceListId, priceListName: r.priceList?.name || '',
      inventoryItemId: r.inventoryItemId, itemName: r.inventoryItem?.name || '',
      price: r.price,
      createdAt: fmtDate(r.createdAt), updatedAt: fmtDate(r.updatedAt),
    }),
  },
  {
    name: 'Attendance',
    header: ['id', 'staffId', 'staffName', 'date', 'checkIn', 'checkOut', 'status', 'checkInMethod', 'checkOutMethod', 'workingHours', 'notes', 'isDeleted', 'deletedAt', 'createdAt', 'updatedAt'],
    getData: (tid) => db.staffAttendance.findMany({
      where: { tenantId: tid },
      include: { staff: { select: { name: true } } }
    }),
    mapRow: (r) => ({
      id: r.id, staffId: r.staffId, staffName: r.staff?.name || '',
      date: fmtDate(r.date), checkIn: fmtDateTime(r.checkIn), checkOut: fmtDateTime(r.checkOut),
      status: r.status, checkInMethod: r.checkInMethod, checkOutMethod: r.checkOutMethod,
      workingHours: r.workingHours, notes: r.notes || '',
      isDeleted: r.isDeleted ? 'Yes' : 'No', deletedAt: fmtDate(r.deletedAt),
      createdAt: fmtDate(r.createdAt), updatedAt: fmtDate(r.updatedAt),
    }),
  },
]

// ============================================================
// Helper Functions
// ============================================================

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return ''
  try {
    const date = new Date(d as string | number | Date)
    if (isNaN(date.getTime())) return ''
    return date.toISOString().slice(0, 10)
  } catch {
    return ''
  }
}

function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return ''
  try {
    const date = new Date(d as string | number | Date)
    if (isNaN(date.getTime())) return ''
    return date.toISOString().replace('T', ' ').slice(0, 19)
  } catch {
    return ''
  }
}

// ============================================================
// Main Export Function: Generate Excel Backup Buffer
// ============================================================

/**
 * Generate a comprehensive multi-sheet Excel backup for a tenant.
 * Returns a Buffer containing the .xlsx file data.
 * Each data model gets its own sheet with clear headers and all records.
 */
export async function generateExcelBackup(tenantId: string): Promise<{ buffer: Buffer; meta: BackupMeta }> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()

  // Get tenant info (Tenant model doesn't have isDeleted field)
  const tenant = await db.tenant.findFirst({ where: { id: tenantId } })
  const companyName = tenant?.name || 'Unknown'

  let totalRecords = 0
  const sheetNames: string[] = []

  // Create a metadata sheet first
  const metaSheetData = [
    { Key: 'Application', Value: 'BizBook Pro' },
    { Key: 'Version', Value: '2.0' },
    { Key: 'Export Date', Value: new Date().toISOString() },
    { Key: 'Company', Value: companyName },
    { Key: 'Company ID', Value: tenantId },
    { Key: 'Total Records', Value: '' }, // Will be filled after
    { Key: 'Sheets', Value: '' }, // Will be filled after
    { Key: '', Value: '' },
    { Key: 'IMPORTANT', Value: 'This file contains your complete business data backup.' },
    { Key: '', Value: 'Keep this file safe - it ensures zero data loss.' },
    { Key: '', Value: 'You can upload this file back to BizBook Pro to restore your data.' },
    { Key: '', Value: 'Each sheet represents a different data category.' },
    { Key: '', Value: '' },
    { Key: 'RESTORE INSTRUCTIONS', Value: '' },
    { Key: '1.', Value: 'Go to Backup & Restore page in BizBook Pro' },
    { Key: '2.', Value: 'Click "Upload Excel Backup" button' },
    { Key: '3.', Value: 'Select this .xlsx file' },
    { Key: '4.', Value: 'Review the data preview and click Restore' },
  ]
  const metaWs = XLSX.utils.json_to_sheet(metaSheetData)
  metaWs['!cols'] = [{ wch: 25 }, { wch: 60 }]
  XLSX.utils.book_append_sheet(wb, metaWs, '_README')
  sheetNames.push('_README')

  // Generate each data sheet
  for (const config of SHEET_CONFIGS) {
    try {
      const data = await config.getData(tenantId)
      totalRecords += data.length

      const rows = data.map(config.mapRow)

      // Create sheet (even if empty - shows the structure)
      const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{}])

      // Auto-fit column widths
      const allKeys = rows.length > 0 ? Object.keys(rows[0]) : config.header
      ws['!cols'] = allKeys.map((key) => {
        const maxLen = Math.max(
          key.length,
          ...rows.map((row) => String(row[key] ?? '').length)
        )
        return { wch: Math.min(maxLen + 2, 50) }
      })

      XLSX.utils.book_append_sheet(wb, ws, config.name)
      sheetNames.push(config.name)
    } catch (err) {
      console.error(`[EXCEL-BACKUP] Error generating sheet "${config.name}":`, err)
      // Create empty sheet with error note
      const ws = XLSX.utils.json_to_sheet([{ Error: `Failed to export: ${err}` }])
      XLSX.utils.book_append_sheet(wb, ws, config.name)
      sheetNames.push(config.name)
    }
  }

  // Update meta sheet with totals
  metaSheetData[5].Value = String(totalRecords)
  metaSheetData[6].Value = sheetNames.join(', ')
  const updatedMetaWs = XLSX.utils.json_to_sheet(metaSheetData)
  updatedMetaWs['!cols'] = [{ wch: 25 }, { wch: 60 }]
  // Replace the meta sheet
  XLSX.utils.book_append_sheet(wb, updatedMetaWs, '_README', true)

  // Generate buffer
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  const meta: BackupMeta = {
    version: '2.0',
    app: 'BizBook Pro',
    exportedAt: new Date().toISOString(),
    company: companyName,
    tenantId,
    totalRecords,
    sheets: sheetNames,
  }

  return { buffer, meta }
}

// ============================================================
// Import Function: Restore from Excel file
// ============================================================

/**
 * Parse an uploaded Excel file and return structured data for import.
 * This reads each sheet and maps the data back to BizBook Pro models.
 */
export async function parseExcelBackup(buffer: Buffer): Promise<{
  success: boolean
  data: Record<string, any[]>
  meta: BackupMeta | null
  errors: string[]
  warnings: string[]
}> {
  const XLSX = await import('xlsx')
  const errors: string[] = []
  const warnings: string[] = []
  const data: Record<string, any[]> = {}

  try {
    const wb = XLSX.read(buffer, { type: 'buffer' })

    // Read metadata from _README sheet
    let meta: BackupMeta | null = null
    if (wb.SheetNames.includes('_README')) {
      const metaRows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets['_README'])
      const metaMap: Record<string, string> = {}
      metaRows.forEach((row) => {
        if (row.Key) metaMap[row.Key] = row.Value || ''
      })
      meta = {
        version: metaMap['Version'] || '2.0',
        app: metaMap['Application'] || 'BizBook Pro',
        exportedAt: metaMap['Export Date'] || new Date().toISOString(),
        company: metaMap['Company'] || 'Unknown',
        tenantId: metaMap['Company ID'] || '',
        totalRecords: parseInt(metaMap['Total Records'] || '0'),
        sheets: (metaMap['Sheets'] || '').split(',').filter(Boolean),
      }
    }

    // Read each data sheet
    for (const sheetName of wb.SheetNames) {
      if (sheetName === '_README') continue

      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName])
      if (rows.length === 0) {
        warnings.push(`Sheet "${sheetName}" is empty`)
        continue
      }

      data[sheetName] = rows
    }

    return { success: true, data, meta, errors, warnings }
  } catch (err) {
    errors.push(`Failed to parse Excel file: ${err instanceof Error ? err.message : String(err)}`)
    return { success: false, data, meta: null, errors, warnings }
  }
}

/**
 * Restore data from parsed Excel backup into the database.
 * Uses upsert to avoid duplicate key errors.
 */
export async function restoreFromExcelData(
  tenantId: string,
  excelData: Record<string, any[]>,
  userRole?: string
): Promise<{
  success: boolean
  restoredCount: number
  errors: string[]
  details: Record<string, number>
}> {
  // Role check
  if (userRole === 'VIEW_ONLY') {
    return { success: false, restoredCount: 0, errors: ['VIEW_ONLY users cannot restore data'], details: {} }
  }

  const errors: string[] = []
  const details: Record<string, number> = {}
  let totalRestored = 0

  // Restore order: independent entities first, then dependent ones
  const restoreOrder = [
    'Parties',
    'Inventory',
    'Products',
    'ProductIngredients',
    'Accounts',
    'Staff',
    'Sales',
    'Purchases',
    'Expenses',
    'Payments',
    'Receipts',
    'BankTransactions',
    'SalaryPayments',
    'Debtors',
    'Creditors',
    'JournalEntries',
    'JournalEntryLines',
    'Batches',
    'PriceLists',
    'PriceListItems',
    'Attendance',
  ]

  for (const sheetName of restoreOrder) {
    const rows = excelData[sheetName]
    if (!rows || rows.length === 0) continue

    let sheetCount = 0

    try {
      switch (sheetName) {
        case 'Parties':
          for (const row of rows) {
            try {
              await db.party.upsert({
                where: { id: String(row.id || '') },
                update: {
                  name: String(row.name || 'Unknown'),
                  type: String(row.type || 'BOTH'),
                  phone: strOrNull(row.phone),
                  email: strOrNull(row.email),
                  address: strOrNull(row.address),
                  gstNumber: strOrNull(row.gstNumber),
                  panNumber: strOrNull(row.panNumber),
                  openingBalance: num(row.openingBalance),
                  currentBalance: num(row.currentBalance),
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
                create: {
                  id: String(row.id),
                  name: String(row.name || 'Unknown'),
                  type: String(row.type || 'BOTH'),
                  phone: strOrNull(row.phone),
                  email: strOrNull(row.email),
                  address: strOrNull(row.address),
                  gstNumber: strOrNull(row.gstNumber),
                  panNumber: strOrNull(row.panNumber),
                  openingBalance: num(row.openingBalance),
                  currentBalance: num(row.currentBalance),
                  tenantId,
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
              })
              sheetCount++
            } catch (e: any) {
              errors.push(`Party "${row.name}": ${e.message}`)
            }
          }
          break

        case 'Inventory':
          for (const row of rows) {
            try {
              await db.inventoryItem.upsert({
                where: { id: String(row.id || '') },
                update: {
                  name: String(row.name || 'Unknown'),
                  sku: strOrNull(row.sku),
                  barcode: strOrNull(row.barcode),
                  hsnCode: strOrNull(row.hsnCode),
                  unit: String(row.unit || 'PCS'),
                  category: strOrNull(row.category),
                  brand: strOrNull(row.brand),
                  itemType: String(row.itemType || 'RAW_MATERIAL'),
                  purchasePrice: num(row.purchasePrice),
                  salePrice: num(row.salePrice),
                  mrp: num(row.mrp),
                  openingStock: num(row.openingStock),
                  currentStock: num(row.currentStock),
                  minStock: num(row.minStock),
                  gstRate: num(row.gstRate),
                  value: num(row.value),
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
                create: {
                  id: String(row.id),
                  name: String(row.name || 'Unknown'),
                  sku: strOrNull(row.sku),
                  barcode: strOrNull(row.barcode),
                  hsnCode: strOrNull(row.hsnCode),
                  unit: String(row.unit || 'PCS'),
                  category: strOrNull(row.category),
                  brand: strOrNull(row.brand),
                  itemType: String(row.itemType || 'RAW_MATERIAL'),
                  purchasePrice: num(row.purchasePrice),
                  salePrice: num(row.salePrice),
                  mrp: num(row.mrp),
                  openingStock: num(row.openingStock),
                  currentStock: num(row.currentStock),
                  minStock: num(row.minStock),
                  gstRate: num(row.gstRate),
                  value: num(row.value),
                  tenantId,
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
              })
              sheetCount++
            } catch (e: any) {
              errors.push(`Inventory "${row.name}": ${e.message}`)
            }
          }
          break

        case 'Products':
          for (const row of rows) {
            try {
              await db.product.upsert({
                where: { id: String(row.id || '') },
                update: {
                  name: String(row.name || 'Unknown'),
                  description: strOrNull(row.description),
                  sku: strOrNull(row.sku),
                  category: strOrNull(row.category),
                  salePrice: num(row.salePrice),
                  gstRate: num(row.gstRate),
                  isActive: row.isActive !== 'No',
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
                create: {
                  id: String(row.id),
                  name: String(row.name || 'Unknown'),
                  description: strOrNull(row.description),
                  sku: strOrNull(row.sku),
                  category: strOrNull(row.category),
                  salePrice: num(row.salePrice),
                  gstRate: num(row.gstRate),
                  isActive: row.isActive !== 'No',
                  tenantId,
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
              })
              sheetCount++
            } catch (e: any) {
              errors.push(`Product "${row.name}": ${e.message}`)
            }
          }
          break

        case 'Accounts':
          for (const row of rows) {
            try {
              await db.account.upsert({
                where: { id: String(row.id || '') },
                update: {
                  accountCode: String(row.accountCode || ''),
                  name: String(row.name || ''),
                  type: String(row.type || 'Asset'),
                  description: strOrNull(row.description),
                  isActive: row.isActive !== 'No',
                  parentId: strOrNull(row.parentId),
                },
                create: {
                  id: String(row.id),
                  accountCode: String(row.accountCode || ''),
                  name: String(row.name || ''),
                  type: String(row.type || 'Asset'),
                  description: strOrNull(row.description),
                  isActive: row.isActive !== 'No',
                  parentId: strOrNull(row.parentId),
                  tenantId,
                },
              })
              sheetCount++
            } catch (e: any) {
              errors.push(`Account "${row.name}": ${e.message}`)
            }
          }
          break

        case 'Staff':
          for (const row of rows) {
            try {
              await db.staff.upsert({
                where: { id: String(row.id || '') },
                update: {
                  name: String(row.name || 'Unknown'),
                  phone: strOrNull(row.phone),
                  email: strOrNull(row.email),
                  role: strOrNull(row.role),
                  department: strOrNull(row.department),
                  salary: num(row.salary),
                  joinDate: dateOrNull(row.joinDate),
                  address: strOrNull(row.address),
                  aadhaar: strOrNull(row.aadhaar),
                  pan: strOrNull(row.pan),
                  fingerprintId: strOrNull(row.fingerprintId),
                  isActive: row.isActive !== 'No',
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
                create: {
                  id: String(row.id),
                  name: String(row.name || 'Unknown'),
                  phone: strOrNull(row.phone),
                  email: strOrNull(row.email),
                  role: strOrNull(row.role),
                  department: strOrNull(row.department),
                  salary: num(row.salary),
                  joinDate: dateOrNull(row.joinDate),
                  address: strOrNull(row.address),
                  aadhaar: strOrNull(row.aadhaar),
                  pan: strOrNull(row.pan),
                  fingerprintId: strOrNull(row.fingerprintId),
                  isActive: row.isActive !== 'No',
                  tenantId,
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
              })
              sheetCount++
            } catch (e: any) {
              errors.push(`Staff "${row.name}": ${e.message}`)
            }
          }
          break

        case 'Sales':
          for (const row of rows) {
            try {
              await db.sale.upsert({
                where: { id: String(row.id || '') },
                update: {
                  invoiceNumber: String(row.invoiceNumber || ''),
                  date: dateOrNow(row.date),
                  partyName: String(row.partyName || ''),
                  partyAddress: strOrNull(row.partyAddress),
                  partyGst: strOrNull(row.partyGst),
                  items: typeof row.items === 'string' ? row.items : JSON.stringify(row.items || []),
                  subtotal: num(row.subtotal),
                  gstAmount: num(row.gstAmount),
                  totalAmount: num(row.totalAmount),
                  invoiceType: String(row.invoiceType || 'TAX_INVOICE'),
                  invoiceStatus: String(row.invoiceStatus || 'CONFIRMED'),
                  paymentStatus: String(row.paymentStatus || 'PENDING'),
                  amountReceived: num(row.amountReceived),
                  amountPaid: num(row.amountPaid),
                  notes: strOrNull(row.notes),
                  einvoiceIrn: strOrNull(row.einvoiceIrn),
                  einvoiceAckNo: strOrNull(row.einvoiceAckNo),
                  einvoiceAckDate: strOrNull(row.einvoiceAckDate),
                  einvoiceStatus: String(row.einvoiceStatus || 'PENDING'),
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
                create: {
                  id: String(row.id),
                  invoiceNumber: String(row.invoiceNumber || ''),
                  date: dateOrNow(row.date),
                  partyName: String(row.partyName || ''),
                  partyAddress: strOrNull(row.partyAddress),
                  partyGst: strOrNull(row.partyGst),
                  items: typeof row.items === 'string' ? row.items : JSON.stringify(row.items || []),
                  subtotal: num(row.subtotal),
                  gstAmount: num(row.gstAmount),
                  totalAmount: num(row.totalAmount),
                  invoiceType: String(row.invoiceType || 'TAX_INVOICE'),
                  invoiceStatus: String(row.invoiceStatus || 'CONFIRMED'),
                  paymentStatus: String(row.paymentStatus || 'PENDING'),
                  amountReceived: num(row.amountReceived),
                  amountPaid: num(row.amountPaid),
                  notes: strOrNull(row.notes),
                  einvoiceIrn: strOrNull(row.einvoiceIrn),
                  einvoiceAckNo: strOrNull(row.einvoiceAckNo),
                  einvoiceAckDate: strOrNull(row.einvoiceAckDate),
                  einvoiceStatus: String(row.einvoiceStatus || 'PENDING'),
                  tenantId,
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
              })
              sheetCount++
            } catch (e: any) {
              errors.push(`Sale "${row.invoiceNumber}": ${e.message}`)
            }
          }
          break

        case 'Purchases':
          for (const row of rows) {
            try {
              await db.purchase.upsert({
                where: { id: String(row.id || '') },
                update: {
                  invoiceNumber: String(row.invoiceNumber || ''),
                  date: dateOrNow(row.date),
                  partyName: String(row.partyName || ''),
                  partyAddress: strOrNull(row.partyAddress),
                  partyGst: strOrNull(row.partyGst),
                  items: typeof row.items === 'string' ? row.items : JSON.stringify(row.items || []),
                  subtotal: num(row.subtotal),
                  gstAmount: num(row.gstAmount),
                  totalAmount: num(row.totalAmount),
                  paymentStatus: String(row.paymentStatus || 'UNPAID'),
                  amountPaid: num(row.amountPaid),
                  notes: strOrNull(row.notes),
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
                create: {
                  id: String(row.id),
                  invoiceNumber: String(row.invoiceNumber || ''),
                  date: dateOrNow(row.date),
                  partyName: String(row.partyName || ''),
                  partyAddress: strOrNull(row.partyAddress),
                  partyGst: strOrNull(row.partyGst),
                  items: typeof row.items === 'string' ? row.items : JSON.stringify(row.items || []),
                  subtotal: num(row.subtotal),
                  gstAmount: num(row.gstAmount),
                  totalAmount: num(row.totalAmount),
                  paymentStatus: String(row.paymentStatus || 'UNPAID'),
                  amountPaid: num(row.amountPaid),
                  notes: strOrNull(row.notes),
                  tenantId,
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
              })
              sheetCount++
            } catch (e: any) {
              errors.push(`Purchase "${row.invoiceNumber}": ${e.message}`)
            }
          }
          break

        case 'Expenses':
          for (const row of rows) {
            try {
              await db.expense.upsert({
                where: { id: String(row.id || '') },
                update: {
                  date: dateOrNow(row.date),
                  category: String(row.category || 'General'),
                  description: String(row.description || ''),
                  amount: num(row.amount),
                  paymentMode: String(row.paymentMode || 'CASH'),
                  reference: strOrNull(row.reference),
                  notes: strOrNull(row.notes),
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
                create: {
                  id: String(row.id),
                  date: dateOrNow(row.date),
                  category: String(row.category || 'General'),
                  description: String(row.description || ''),
                  amount: num(row.amount),
                  paymentMode: String(row.paymentMode || 'CASH'),
                  reference: strOrNull(row.reference),
                  notes: strOrNull(row.notes),
                  tenantId,
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
              })
              sheetCount++
            } catch (e: any) {
              errors.push(`Expense "${row.description}": ${e.message}`)
            }
          }
          break

        case 'Payments':
          for (const row of rows) {
            try {
              await db.payment.upsert({
                where: { id: String(row.id || '') },
                update: {
                  date: dateOrNow(row.date),
                  partyName: String(row.partyName || ''),
                  amount: num(row.amount),
                  paymentMode: String(row.paymentMode || 'CASH'),
                  reference: strOrNull(row.reference),
                  purpose: strOrNull(row.purpose),
                  invoiceRef: strOrNull(row.invoiceRef),
                  notes: strOrNull(row.notes),
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
                create: {
                  id: String(row.id),
                  date: dateOrNow(row.date),
                  partyName: String(row.partyName || ''),
                  amount: num(row.amount),
                  paymentMode: String(row.paymentMode || 'CASH'),
                  reference: strOrNull(row.reference),
                  purpose: strOrNull(row.purpose),
                  invoiceRef: strOrNull(row.invoiceRef),
                  notes: strOrNull(row.notes),
                  tenantId,
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
              })
              sheetCount++
            } catch (e: any) {
              errors.push(`Payment "${row.partyName}": ${e.message}`)
            }
          }
          break

        case 'Receipts':
          for (const row of rows) {
            try {
              await db.receipt.upsert({
                where: { id: String(row.id || '') },
                update: {
                  date: dateOrNow(row.date),
                  partyName: String(row.partyName || ''),
                  amount: num(row.amount),
                  paymentMode: String(row.paymentMode || 'CASH'),
                  reference: strOrNull(row.reference),
                  purpose: strOrNull(row.purpose),
                  invoiceRef: strOrNull(row.invoiceRef),
                  notes: strOrNull(row.notes),
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
                create: {
                  id: String(row.id),
                  date: dateOrNow(row.date),
                  partyName: String(row.partyName || ''),
                  amount: num(row.amount),
                  paymentMode: String(row.paymentMode || 'CASH'),
                  reference: strOrNull(row.reference),
                  purpose: strOrNull(row.purpose),
                  invoiceRef: strOrNull(row.invoiceRef),
                  notes: strOrNull(row.notes),
                  tenantId,
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
              })
              sheetCount++
            } catch (e: any) {
              errors.push(`Receipt "${row.partyName}": ${e.message}`)
            }
          }
          break

        case 'BankTransactions':
          for (const row of rows) {
            try {
              await db.bankTransaction.upsert({
                where: { id: String(row.id || '') },
                update: {
                  date: dateOrNow(row.date),
                  description: String(row.description || ''),
                  reference: strOrNull(row.reference),
                  deposit: num(row.deposit),
                  withdrawal: num(row.withdrawal),
                  balance: num(row.balance),
                  category: strOrNull(row.category),
                  bankName: strOrNull(row.bankName),
                  accountNumber: strOrNull(row.accountNumber),
                  isReconciled: row.isReconciled === 'Yes',
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
                create: {
                  id: String(row.id),
                  date: dateOrNow(row.date),
                  description: String(row.description || ''),
                  reference: strOrNull(row.reference),
                  deposit: num(row.deposit),
                  withdrawal: num(row.withdrawal),
                  balance: num(row.balance),
                  category: strOrNull(row.category),
                  bankName: strOrNull(row.bankName),
                  accountNumber: strOrNull(row.accountNumber),
                  isReconciled: row.isReconciled === 'Yes',
                  tenantId,
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
              })
              sheetCount++
            } catch (e: any) {
              errors.push(`BankTxn "${row.description}": ${e.message}`)
            }
          }
          break

        case 'SalaryPayments':
          for (const row of rows) {
            try {
              await db.salaryPayment.upsert({
                where: { id: String(row.id || '') },
                update: {
                  staffId: String(row.staffId || ''),
                  month: String(row.month || ''),
                  amount: num(row.amount),
                  paidDate: dateOrNow(row.paidDate),
                  paymentMode: String(row.paymentMode || 'BANK'),
                  status: String(row.status || 'PAID'),
                  notes: strOrNull(row.notes),
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
                create: {
                  id: String(row.id),
                  staffId: String(row.staffId || ''),
                  month: String(row.month || ''),
                  amount: num(row.amount),
                  paidDate: dateOrNow(row.paidDate),
                  paymentMode: String(row.paymentMode || 'BANK'),
                  status: String(row.status || 'PAID'),
                  notes: strOrNull(row.notes),
                  tenantId,
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
              })
              sheetCount++
            } catch (e: any) {
              errors.push(`SalaryPayment "${row.staffId}": ${e.message}`)
            }
          }
          break

        case 'Debtors':
          for (const row of rows) {
            try {
              await db.debtor.upsert({
                where: { id: String(row.id || '') },
                update: {
                  name: String(row.name || 'Unknown'),
                  phone: strOrNull(row.phone),
                  email: strOrNull(row.email),
                  address: strOrNull(row.address),
                  gstNumber: strOrNull(row.gstNumber),
                  openingBalance: num(row.openingBalance),
                  currentBalance: num(row.currentBalance),
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
                create: {
                  id: String(row.id),
                  name: String(row.name || 'Unknown'),
                  phone: strOrNull(row.phone),
                  email: strOrNull(row.email),
                  address: strOrNull(row.address),
                  gstNumber: strOrNull(row.gstNumber),
                  openingBalance: num(row.openingBalance),
                  currentBalance: num(row.currentBalance),
                  tenantId,
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
              })
              sheetCount++
            } catch (e: any) {
              errors.push(`Debtor "${row.name}": ${e.message}`)
            }
          }
          break

        case 'Creditors':
          for (const row of rows) {
            try {
              await db.creditor.upsert({
                where: { id: String(row.id || '') },
                update: {
                  name: String(row.name || 'Unknown'),
                  phone: strOrNull(row.phone),
                  email: strOrNull(row.email),
                  address: strOrNull(row.address),
                  gstNumber: strOrNull(row.gstNumber),
                  openingBalance: num(row.openingBalance),
                  currentBalance: num(row.currentBalance),
                  sourceType: String(row.sourceType || 'PURCHASE'),
                  sourceId: strOrNull(row.sourceId),
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
                create: {
                  id: String(row.id),
                  name: String(row.name || 'Unknown'),
                  phone: strOrNull(row.phone),
                  email: strOrNull(row.email),
                  address: strOrNull(row.address),
                  gstNumber: strOrNull(row.gstNumber),
                  openingBalance: num(row.openingBalance),
                  currentBalance: num(row.currentBalance),
                  sourceType: String(row.sourceType || 'PURCHASE'),
                  sourceId: strOrNull(row.sourceId),
                  tenantId,
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
              })
              sheetCount++
            } catch (e: any) {
              errors.push(`Creditor "${row.name}": ${e.message}`)
            }
          }
          break

        case 'JournalEntries':
          for (const row of rows) {
            try {
              await db.journalEntry.upsert({
                where: { id: String(row.id || '') },
                update: {
                  entryDate: dateOrNow(row.entryDate),
                  reference: strOrNull(row.reference),
                  description: String(row.description || ''),
                  isPosted: row.isPosted === 'Yes',
                  sourceType: strOrNull(row.sourceType),
                  sourceId: strOrNull(row.sourceId),
                  createdBy: strOrNull(row.createdBy),
                },
                create: {
                  id: String(row.id),
                  entryDate: dateOrNow(row.entryDate),
                  reference: strOrNull(row.reference),
                  description: String(row.description || ''),
                  isPosted: row.isPosted === 'Yes',
                  sourceType: strOrNull(row.sourceType),
                  sourceId: strOrNull(row.sourceId),
                  createdBy: strOrNull(row.createdBy),
                  tenantId,
                },
              })
              sheetCount++
            } catch (e: any) {
              errors.push(`JournalEntry "${row.id}": ${e.message}`)
            }
          }
          break

        case 'JournalEntryLines':
          for (const row of rows) {
            try {
              await db.journalEntryLine.upsert({
                where: { id: String(row.id || '') },
                update: {
                  entryId: String(row.entryId || ''),
                  accountId: String(row.accountId || ''),
                  debit: num(row.debit),
                  credit: num(row.credit),
                  description: strOrNull(row.description),
                },
                create: {
                  id: String(row.id),
                  entryId: String(row.entryId || ''),
                  accountId: String(row.accountId || ''),
                  debit: num(row.debit),
                  credit: num(row.credit),
                  description: strOrNull(row.description),
                },
              })
              sheetCount++
            } catch (e: any) {
              errors.push(`JournalEntryLine "${row.id}": ${e.message}`)
            }
          }
          break

        case 'Batches':
          for (const row of rows) {
            try {
              await db.batch.upsert({
                where: { id: String(row.id || '') },
                update: {
                  inventoryItemId: String(row.inventoryItemId || ''),
                  batchNumber: String(row.batchNumber || ''),
                  manufacturingDate: dateOrNull(row.manufacturingDate),
                  expiryDate: dateOrNull(row.expiryDate),
                  quantity: num(row.quantity),
                  supplier: strOrNull(row.supplier),
                  notes: strOrNull(row.notes),
                  isActive: row.isActive !== 'No',
                },
                create: {
                  id: String(row.id),
                  inventoryItemId: String(row.inventoryItemId || ''),
                  batchNumber: String(row.batchNumber || ''),
                  manufacturingDate: dateOrNull(row.manufacturingDate),
                  expiryDate: dateOrNull(row.expiryDate),
                  quantity: num(row.quantity),
                  supplier: strOrNull(row.supplier),
                  notes: strOrNull(row.notes),
                  isActive: row.isActive !== 'No',
                  tenantId,
                },
              })
              sheetCount++
            } catch (e: any) {
              errors.push(`Batch "${row.batchNumber}": ${e.message}`)
            }
          }
          break

        case 'PriceLists':
          for (const row of rows) {
            try {
              await db.priceList.upsert({
                where: { id: String(row.id || '') },
                update: {
                  name: String(row.name || ''),
                  description: strOrNull(row.description),
                  isDefault: row.isDefault === 'Yes',
                  isActive: row.isActive !== 'No',
                },
                create: {
                  id: String(row.id),
                  name: String(row.name || ''),
                  description: strOrNull(row.description),
                  isDefault: row.isDefault === 'Yes',
                  isActive: row.isActive !== 'No',
                  tenantId,
                },
              })
              sheetCount++
            } catch (e: any) {
              errors.push(`PriceList "${row.name}": ${e.message}`)
            }
          }
          break

        case 'PriceListItems':
          for (const row of rows) {
            try {
              await db.priceListItem.upsert({
                where: { id: String(row.id || '') },
                update: {
                  priceListId: String(row.priceListId || ''),
                  inventoryItemId: String(row.inventoryItemId || ''),
                  price: num(row.price),
                },
                create: {
                  id: String(row.id),
                  priceListId: String(row.priceListId || ''),
                  inventoryItemId: String(row.inventoryItemId || ''),
                  price: num(row.price),
                },
              })
              sheetCount++
            } catch (e: any) {
              errors.push(`PriceListItem "${row.id}": ${e.message}`)
            }
          }
          break

        case 'Attendance':
          for (const row of rows) {
            try {
              await db.staffAttendance.upsert({
                where: { id: String(row.id || '') },
                update: {
                  staffId: String(row.staffId || ''),
                  date: dateOrNow(row.date),
                  checkIn: dateOrNull(row.checkIn),
                  checkOut: dateOrNull(row.checkOut),
                  status: String(row.status || 'PRESENT'),
                  checkInMethod: String(row.checkInMethod || 'MANUAL'),
                  checkOutMethod: String(row.checkOutMethod || 'MANUAL'),
                  workingHours: num(row.workingHours),
                  notes: strOrNull(row.notes),
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
                create: {
                  id: String(row.id),
                  staffId: String(row.staffId || ''),
                  date: dateOrNow(row.date),
                  checkIn: dateOrNull(row.checkIn),
                  checkOut: dateOrNull(row.checkOut),
                  status: String(row.status || 'PRESENT'),
                  checkInMethod: String(row.checkInMethod || 'MANUAL'),
                  checkOutMethod: String(row.checkOutMethod || 'MANUAL'),
                  workingHours: num(row.workingHours),
                  notes: strOrNull(row.notes),
                  tenantId,
                  isDeleted: row.isDeleted === 'Yes',
                  deletedAt: dateOrNull(row.deletedAt),
                },
              })
              sheetCount++
            } catch (e: any) {
              errors.push(`Attendance "${row.staffId}": ${e.message}`)
            }
          }
          break
      }
    } catch (err) {
      errors.push(`Sheet "${sheetName}" failed: ${err instanceof Error ? err.message : String(err)}`)
    }

    details[sheetName] = sheetCount
    totalRestored += sheetCount
  }

  return {
    success: errors.length === 0 || totalRestored > 0,
    restoredCount: totalRestored,
    errors,
    details,
  }
}

// ============================================================
// Value Helpers for Import
// ============================================================

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === '' || v === 'null') return null
  return String(v)
}

function num(v: unknown): number {
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

function dateOrNull(v: unknown): Date | null {
  if (!v || v === '' || v === 'null') return null
  try {
    const d = new Date(v as string | number | Date)
    return isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

function dateOrNow(v: unknown): Date {
  const d = dateOrNull(v)
  return d || new Date()
}
