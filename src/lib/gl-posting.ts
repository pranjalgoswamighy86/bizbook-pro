import { roundTo2, isInterStateSupply, splitGSTAmount } from '@/lib/gst-utils'
import { assertJEBalance } from '@/lib/je-balance'

// =====================================================================
// v6.29.0: Shared General-Ledger posting helpers
// =====================================================================
// Extracted from src/app/api/sales/route.ts and src/app/api/purchases/route.ts
// so the AI Smart Import pipeline (and any future bulk-import path) can post
// identical Journal Entries to the GL — instead of silently bypassing the
// accounting engine like the old `db.sale.create({...})` direct insert did.
//
// Every helper:
//   • Resolves (or auto-creates) the Chart of Accounts rows it needs
//   • Computes the correct gross/net subtotal respecting 0% GST (v6.28.7 fix)
//   • Splits CGST/SGST/IGST correctly for inter vs intra-state (v6.28.x fix)
//   • Calls assertJEBalance() BEFORE creating the JE — catches off-by-discount
//     bugs at posting time rather than in the Trial Balance days later
//   • Creates the JournalEntry + JournalEntryLine rows inside the caller's
//     transaction (tx). The caller is responsible for wrapping in db.$transaction.
//
// IMPORTANT: These helpers assume the Sale/Purchase/Expense row has ALREADY
// been created in the same tx. They read sale.id / purchase.id / expense.id
// for the `sourceId` field on the JE.
// =====================================================================

interface JELineInput {
  accountId: string
  debit: number
  credit: number
  description: string
}

// ---------------------------------------------------------------------
// Account code constants — single source of truth
// ---------------------------------------------------------------------
export const AC = {
  CASH: '10100',
  BANK: '10200',
  DEBTORS: '10300',
  CGST_INPUT: '10601',
  SGST_INPUT: '10602',
  IGST_INPUT: '10603',
  CREDITORS: '20100',
  GST_PAYABLE: '20200',
  CGST_PAYABLE: '20201',
  SGST_PAYABLE: '20202',
  IGST_PAYABLE: '20203',
  SALES_REVENUE: '40100',
  DISCOUNT_ALLOWED: '40150',
  PURCHASE_EXPENSE: '50200',
  GST_INPUT_LEGACY: '50600',
  // Expense accounts (mirrors expenses/route.ts categoryToAccountCode)
  EXP_RENT: '50300',
  EXP_SALARY: '50400',
  EXP_UTILITY: '50500',
  EXP_OFFICE: '50700',
  EXP_TRAVEL: '50800',
  EXP_DEPRECIATION: '50900',
  EXP_BANK_CHARGES: '51000',
  EXP_MISC: '51100',
} as const

// ---------------------------------------------------------------------
// Account cache — avoid re-querying the CoA on every record of a bulk
// import. The cache is per-tenantId + per-transaction (callers should
// create a fresh cache for each db.$transaction block).
// ---------------------------------------------------------------------
export class AccountCache {
  private cache = new Map<string, { id: string; type: string }>()
  private fetched = false

  constructor(
    private tx: any,
    private tenantId: string,
  ) {}

  private async ensureLoaded() {
    if (this.fetched) return
    const rows = await this.tx.account.findMany({ where: { tenantId: this.tenantId } })
    for (const r of rows) this.cache.set(r.accountCode, { id: r.id, type: r.type })
    this.fetched = true
  }

  async find(code: string): Promise<{ id: string; type: string } | undefined> {
    await this.ensureLoaded()
    return this.cache.get(code)
  }

  async ensure(code: string, name: string, type: string): Promise<{ id: string; type: string }> {
    await this.ensureLoaded()
    const existing = this.cache.get(code)
    if (existing) return existing
    const created = await this.tx.account.create({
      data: { accountCode: code, name, type, tenantId: this.tenantId, isActive: true },
    })
    this.cache.set(code, { id: created.id, type })
    return { id: created.id, type }
  }
}

// =====================================================================
// SALE → Journal Entry
// =====================================================================
// Mirrors src/app/api/sales/route.ts lines ~306-447 (v6.28.7 logic).
//
//   Dr Cash            = amountReceived
//   Dr Accounts Recv.  = totalAmount - amountReceived     (credit sale)
//   Dr Discount Allowed = grossSubtotal × discountPercent/100  (if > 0)
//   Cr Sales Revenue   = grossSubtotal                      (GROSS, before discount)
//   Cr GST Payable     = gstAmount (split CGST/SGST/IGST)  (if > 0)
//
// 0% GST (gstAmount = 0): full totalAmount is credited to Sales Revenue.
// =====================================================================
export async function postSaleJE(
  tx: any,
  tenantId: string,
  userId: string | null,
  sale: {
    id: string
    invoiceNumber: string
    date: Date
    partyName: string
    partyGst?: string | null
    subtotal?: number | null
    gstAmount: number
    totalAmount: number
    amountReceived?: number | null
    amountPaid?: number | null
    paymentStatus?: string | null
    paymentMode?: string | null
    discountPercent?: number | null
  },
): Promise<void> {
  const accounts = new AccountCache(tx, tenantId)

  const [
    debtorsAccount, cashAccount, salesAccount,
    cgstPayableAccount, sgstPayableAccount, igstPayableAccount, gstPayableAccount,
  ] = await Promise.all([
    accounts.ensure(AC.DEBTORS, 'Accounts Receivable', 'Asset'),
    accounts.ensure(AC.CASH, 'Cash', 'Asset'),
    accounts.ensure(AC.SALES_REVENUE, 'Sales Revenue', 'Revenue'),
    accounts.ensure(AC.CGST_PAYABLE, 'CGST Payable', 'Liability'),
    accounts.ensure(AC.SGST_PAYABLE, 'SGST Payable', 'Liability'),
    accounts.ensure(AC.IGST_PAYABLE, 'IGST Payable', 'Liability'),
    accounts.ensure(AC.GST_PAYABLE, 'GST Payable', 'Liability'),
  ])

  const isCashSale = (sale.partyName || '').trim().toLowerCase() === 'cash'
  const amountReceived = roundTo2(sale.amountReceived || sale.amountPaid || 0)
  const amountDue = roundTo2(sale.totalAmount - amountReceived)

  // v6.29.2: CRITICAL FIX — grossSubtotal / discount math
  //
  // The pre-discount subtotal (grossSubtotal) is what gets CREDITED to Sales
  // Revenue. The sale-level discount is then posted as a separate DEBIT to
  // Discount Allowed (40150). Balance check:
  //
  //   Dr Cash + Dr Debtors + Dr Discount Allowed = Cr Sales Revenue + Cr GST
  //
  // v6.28.7 BUG: when gstAmount = 0, it set grossSubtotal = totalAmount.
  // That is correct ONLY when there is no sale-level discount (in which
  // case totalAmount == subtotal). But with discountPercent > 0:
  //
  //     totalAmount = (subtotal × (1 - discountPercent/100)) + gstAmount
  //
  // For non-GST (gstAmount=0): totalAmount = subtotal × (1 - dp/100).
  // Setting grossSubtotal = totalAmount makes:
  //   - Sales credit short by `subtotal × dp/100` (the discount amount)
  //   - Discount Allowed computed off the wrong base (post-discount, not pre)
  //   - JE unbalanced by exactly `discountAllowed` (Dr > Cr).
  //
  // v6.29.2 fix: always use sale.subtotal as the gross when available;
  // only fall back to totalAmount - gstAmount (or totalAmount when gst=0)
  // when subtotal is null/0. This matches the v6.28.5 fix's intent.
  const grossSubtotal = sale.subtotal && sale.subtotal > 0
    ? sale.subtotal
    : (sale.gstAmount || 0) > 0
      ? roundTo2(sale.totalAmount - (sale.gstAmount || 0))
      : sale.totalAmount
  const saleDiscountAmount = roundTo2(grossSubtotal * (sale.discountPercent || 0) / 100)

  const jeLines: JELineInput[] = []

  if (isCashSale || amountReceived > 0) {
    jeLines.push({
      accountId: cashAccount.id, debit: amountReceived, credit: 0,
      description: `Cash received for ${sale.invoiceNumber}`,
    })
  }
  if (!isCashSale && amountDue > 0) {
    jeLines.push({
      accountId: debtorsAccount.id, debit: amountDue, credit: 0,
      description: `Receivable from ${sale.partyName} for ${sale.invoiceNumber}`,
    })
  }

  jeLines.push({
    accountId: salesAccount.id, debit: 0, credit: grossSubtotal,
    description: `Sale ${sale.invoiceNumber}`,
  })

  if (saleDiscountAmount > 0.01) {
    const discountAllowed = await accounts.ensure(AC.DISCOUNT_ALLOWED, 'Discount Allowed', 'Expense')
    jeLines.push({
      accountId: discountAllowed.id, debit: saleDiscountAmount, credit: 0,
      description: `Invoice-level discount on ${sale.invoiceNumber}`,
    })
  }

  if (sale.gstAmount > 0) {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } })
    const tenantGstin = tenant?.gstNumber || ''
    const partyGst = sale.partyGst || ''
    if (tenantGstin && partyGst) {
      const interState = isInterStateSupply(tenantGstin, partyGst)
      const { cgst, sgst, igst } = splitGSTAmount(sale.gstAmount, interState)
      if (interState) {
        if (igst > 0) jeLines.push({ accountId: igstPayableAccount.id, debit: 0, credit: roundTo2(igst), description: `IGST on sale ${sale.invoiceNumber}` })
      } else {
        if (cgst > 0) jeLines.push({ accountId: cgstPayableAccount.id, debit: 0, credit: roundTo2(cgst), description: `CGST on sale ${sale.invoiceNumber}` })
        if (sgst > 0) jeLines.push({ accountId: sgstPayableAccount.id, debit: 0, credit: roundTo2(sgst), description: `SGST on sale ${sale.invoiceNumber}` })
      }
    } else {
      jeLines.push({ accountId: gstPayableAccount.id, debit: 0, credit: roundTo2(sale.gstAmount), description: `GST on sale ${sale.invoiceNumber} (GSTINs missing)` })
    }
  }

  assertJEBalance(jeLines, `AI-Import Sale CREATE ${sale.invoiceNumber}`)

  await tx.journalEntry.create({
    data: {
      entryDate: sale.date,
      reference: sale.invoiceNumber,
      description: `Sale invoice ${sale.invoiceNumber} to ${sale.partyName} (AI Import)`,
      sourceType: 'SALE',
      sourceId: sale.id,
      isPosted: true,
      tenantId,
      createdBy: userId,
      lines: { create: jeLines },
    },
  })
}

// =====================================================================
// PURCHASE → Journal Entry
// =====================================================================
// Mirrors src/app/api/purchases/route.ts lines ~230-325 (v6.28.x logic).
//
//   Dr Purchase Expenses = subtotal
//   Dr GST Input Credit  = gstAmount (split CGST/SGST/IGST if GSTINs present)
//   Cr Cash              = amountPaid
//   Cr Accounts Payable  = totalAmount - amountPaid
// =====================================================================
export async function postPurchaseJE(
  tx: any,
  tenantId: string,
  userId: string | null,
  purchase: {
    id: string
    invoiceNumber: string
    date: Date
    partyName: string
    partyGst?: string | null
    subtotal: number
    gstAmount: number
    totalAmount: number
    amountPaid?: number | null
    paymentStatus?: string | null
    paymentMode?: string | null
  },
): Promise<void> {
  const accounts = new AccountCache(tx, tenantId)

  const [
    creditorsAccount, cashAccount, purchaseAccount,
    cgstInputAccount, sgstInputAccount, igstInputAccount, gstInputLegacyAccount,
  ] = await Promise.all([
    accounts.ensure(AC.CREDITORS, 'Accounts Payable', 'Liability'),
    accounts.ensure(AC.CASH, 'Cash', 'Asset'),
    accounts.ensure(AC.PURCHASE_EXPENSE, 'Purchase Expenses', 'Expense'),
    accounts.ensure(AC.CGST_INPUT, 'CGST Input Credit', 'Asset'),
    accounts.ensure(AC.SGST_INPUT, 'SGST Input Credit', 'Asset'),
    accounts.ensure(AC.IGST_INPUT, 'IGST Input Credit', 'Asset'),
    accounts.ensure(AC.GST_INPUT_LEGACY, 'GST Input Credit', 'Asset'),
  ])

  const isCashPurchase = (purchase.partyName || '').trim().toLowerCase() === 'cash'
  const jeLines: JELineInput[] = []

  // Dr Purchase Expenses (excluding GST)
  jeLines.push({
    accountId: purchaseAccount.id, debit: roundTo2(purchase.subtotal), credit: 0,
    description: `Purchase ${purchase.invoiceNumber}`,
  })

  // Dr GST Input Credit
  if (purchase.gstAmount > 0) {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } })
    const tenantGstin = tenant?.gstNumber || ''
    const partyGst = purchase.partyGst || ''
    if (tenantGstin && partyGst) {
      const interState = isInterStateSupply(partyGst, tenantGstin)
      const { cgst, sgst, igst } = splitGSTAmount(purchase.gstAmount, interState)
      if (interState) {
        if (igst > 0) jeLines.push({ accountId: igstInputAccount.id, debit: roundTo2(igst), credit: 0, description: `IGST on purchase ${purchase.invoiceNumber}` })
      } else {
        if (cgst > 0) jeLines.push({ accountId: cgstInputAccount.id, debit: roundTo2(cgst), credit: 0, description: `CGST on purchase ${purchase.invoiceNumber}` })
        if (sgst > 0) jeLines.push({ accountId: sgstInputAccount.id, debit: roundTo2(sgst), credit: 0, description: `SGST on purchase ${purchase.invoiceNumber}` })
      }
    } else {
      jeLines.push({ accountId: gstInputLegacyAccount.id, debit: roundTo2(purchase.gstAmount), credit: 0, description: `GST on purchase ${purchase.invoiceNumber} (unable to determine CGST/SGST/IGST split — GSTINs missing)` })
    }
  }

  // Cr Cash + Creditors (split for partial payment)
  const amountPaid = roundTo2(purchase.amountPaid || 0)
  const amountDue = roundTo2(purchase.totalAmount - amountPaid)
  if (isCashPurchase || amountPaid > 0) {
    jeLines.push({ accountId: cashAccount.id, debit: 0, credit: amountPaid, description: `Cash paid for ${purchase.invoiceNumber}` })
  }
  if (!isCashPurchase && amountDue > 0) {
    jeLines.push({ accountId: creditorsAccount.id, debit: 0, credit: amountDue, description: `Payable to ${purchase.partyName} for ${purchase.invoiceNumber}` })
  }

  assertJEBalance(jeLines, `AI-Import Purchase CREATE ${purchase.invoiceNumber}`)

  await tx.journalEntry.create({
    data: {
      entryDate: purchase.date,
      reference: purchase.invoiceNumber,
      description: `Purchase invoice ${purchase.invoiceNumber} from ${purchase.partyName} (AI Import)`,
      sourceType: 'PURCHASE',
      sourceId: purchase.id,
      isPosted: true,
      tenantId,
      createdBy: userId,
      lines: { create: jeLines },
    },
  })
}

// =====================================================================
// EXPENSE → Journal Entry
// =====================================================================
// Mirrors src/app/api/expenses/route.ts postExpenseJE (v6.27.5 logic).
//
//   Dr <Expense account by category>     amount
//   Cr Cash (10100) OR Bank (10200)      amount
//
// Category → account code mapping is identical to the live expense route.
// =====================================================================
export function expenseCategoryToAccountCode(category: string): string {
  const c = (category || '').toLowerCase().trim()
  if (c.includes('rent')) return AC.EXP_RENT
  if (c.includes('salary') || c.includes('salaries') || c.includes('wage')) return AC.EXP_SALARY
  if (c.includes('utilit') || c.includes('electric') || c.includes('water') || c.includes('internet')) return AC.EXP_UTILITY
  if (c.includes('office') || c.includes('suppl') || c.includes('stationer')) return AC.EXP_OFFICE
  if (c.includes('travel') || c.includes('fuel') || c.includes('conveyance')) return AC.EXP_TRAVEL
  if (c.includes('deprec')) return AC.EXP_DEPRECIATION
  if (c.includes('bank') || c.includes('charge') || c.includes('fee') || c.includes('interest')) return AC.EXP_BANK_CHARGES
  return AC.EXP_MISC
}

export function expensePaymentModeToCreditAccount(paymentMode: string | undefined): string {
  const m = (paymentMode || '').toUpperCase()
  if (m === 'BANK' || m === 'CHEQUE' || m === 'NEFT' || m === 'RTGS' || m === 'UPI') return AC.BANK
  return AC.CASH
}

export async function postExpenseJE(
  tx: any,
  tenantId: string,
  userId: string | null,
  expense: {
    id: string
    date: Date
    category: string
    description: string
    amount: number
    paymentMode?: string | null
  },
): Promise<void> {
  const accounts = new AccountCache(tx, tenantId)
  const expenseAccCode = expenseCategoryToAccountCode(expense.category)
  const creditAccCode = expensePaymentModeToCreditAccount(expense.paymentMode)

  const expenseAccount = await accounts.ensure(expenseAccCode, expense.category || 'Expense', 'Expense')
  const creditAccount = await accounts.ensure(
    creditAccCode,
    creditAccCode === AC.CASH ? 'Cash' : 'Bank Account',
    'Asset',
  )

  const ref = `IMP-EXP/${expense.id.slice(0, 8)}`
  const jeLines: JELineInput[] = [
    { accountId: expenseAccount.id, debit: roundTo2(expense.amount), credit: 0, description: `${expense.category} expense (AI Import)` },
    { accountId: creditAccount.id, debit: 0, credit: roundTo2(expense.amount), description: `Paid via ${expense.paymentMode || 'CASH'} (AI Import)` },
  ]

  assertJEBalance(jeLines, `AI-Import Expense CREATE ${ref}`)

  await tx.journalEntry.create({
    data: {
      entryDate: expense.date,
      reference: ref,
      description: `Expense: ${expense.description || expense.category} (${expense.category}) (AI Import)`,
      sourceType: 'EXPENSE',
      sourceId: expense.id,
      isPosted: true,
      tenantId,
      createdBy: userId,
      lines: { create: jeLines },
    },
  })
}
