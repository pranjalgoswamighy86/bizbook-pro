import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'

/**
 * Data Backup & Export API
 *
 * Actions:
 * - json:  Full company data as JSON (for BizBook Pro backup/restore)
 * - tally: Tally-compatible XML export (for importing into Tally/TallyPrime)
 * - csv:   CSV export of specific data types (sales, purchases, etc.)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    if (!tenantId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 })
    }

    // Verify tenant exists and is not soft-deleted
    const tenant = await db.tenant.findFirst({ where: { id: tenantId, isDeleted: false } })
    if (!tenant) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    // ============================================================
    // JSON Backup — Full company data for BizBook Pro restore
    // ============================================================
    if (action === 'json') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      // Full backup includes ALL records (including soft-deleted) for complete data preservation
      const [sales, purchases, expenses, inventory, bankTransactions, staff, salaryPayments, payments, receipts, debtors, creditors] = await Promise.all([
        db.sale.findMany({ where: { tenantId } }),
        db.purchase.findMany({ where: { tenantId } }),
        db.expense.findMany({ where: { tenantId } }),
        db.inventoryItem.findMany({ where: { tenantId } }),
        db.bankTransaction.findMany({ where: { tenantId } }),
        db.staff.findMany({ where: { tenantId } }),
        db.salaryPayment.findMany({ where: { tenantId } }),
        db.payment.findMany({ where: { tenantId } }),
        db.receipt.findMany({ where: { tenantId } }),
        db.debtor.findMany({ where: { tenantId } }),
        db.creditor.findMany({ where: { tenantId } }),
      ])

      const backup = {
        _meta: {
          version: '1.0',
          app: 'BizBook Pro',
          exportedAt: new Date().toISOString(),
          company: tenant.name,
        },
        tenant: {
          name: tenant.name,
          address: tenant.address,
          phone: tenant.phone,
          email: tenant.email,
          gstNumber: tenant.gstNumber,
          panNumber: tenant.panNumber,
          currency: tenant.currency,
          plan: tenant.plan,
        },
        sales,
        purchases,
        expenses,
        inventory,
        bankTransactions,
        staff,
        salaryPayments,
        payments,
        receipts,
        debtors,
        creditors,
      }

      return NextResponse.json(backup)
    }

    // ============================================================
    // Tally XML Export — Compatible with Tally/TallyPrime import
    // Tally uses XML format (ENVELOPE > TALLYMESSAGE > VOUCHER)
    // ============================================================
    if (action === 'tally') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      // Tally export only includes non-deleted records
      const [sales, purchases, expenses, debtors, creditors, inventory] = await Promise.all([
        db.sale.findMany({ where: { tenantId, isDeleted: false } }),
        db.purchase.findMany({ where: { tenantId, isDeleted: false } }),
        db.expense.findMany({ where: { tenantId, isDeleted: false } }),
        db.debtor.findMany({ where: { tenantId, isDeleted: false } }),
        db.creditor.findMany({ where: { tenantId, isDeleted: false } }),
        db.inventoryItem.findMany({ where: { tenantId, isDeleted: false } }),
      ])

      // Build Tally XML
      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
    <VERSION>1</VERSION>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${escapeXml(tenant.name)}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">`

      // Export Sales as Sales Vouchers
      for (const sale of sales) {
        const saleDate = formatTallyDate(sale.date)
        const items = safeParseJson(sale.items)
        xml += `
        <VOUCHER VCHTYPE="Sales" ACTION="Create">
          <DATE>${saleDate}</DATE>
          <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
          <PARTYNAME>${escapeXml(sale.partyName)}</PARTYNAME>
          <NARRATION>Invoice: ${escapeXml(sale.invoiceNumber)}${sale.notes ? '. ' + escapeXml(sale.notes) : ''}</NARRATION>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(sale.partyName)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${sale.totalAmount.toFixed(2)}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`

        // Add GST ledger if applicable
        if (sale.gstAmount > 0) {
          const cgst = sale.gstAmount / 2
          const sgst = sale.gstAmount / 2
          xml += `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>CGST</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${cgst.toFixed(2)}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>SGST</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${sgst.toFixed(2)}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`
        }

        // Sales account entry
        xml += `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Sales Account</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${sale.subtotal.toFixed(2)}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>`
      }

      // Export Purchases as Purchase Vouchers
      for (const purchase of purchases) {
        const purchaseDate = formatTallyDate(purchase.date)
        xml += `
        <VOUCHER VCHTYPE="Purchase" ACTION="Create">
          <DATE>${purchaseDate}</DATE>
          <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
          <PARTYNAME>${escapeXml(purchase.partyName)}</PARTYNAME>
          <NARRATION>Invoice: ${escapeXml(purchase.invoiceNumber)}${purchase.notes ? '. ' + escapeXml(purchase.notes) : ''}</NARRATION>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(purchase.partyName)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>${purchase.totalAmount.toFixed(2)}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`

        if (purchase.gstAmount > 0) {
          const cgst = purchase.gstAmount / 2
          const sgst = purchase.gstAmount / 2
          xml += `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>CGST</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${cgst.toFixed(2)}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>SGST</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${sgst.toFixed(2)}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`
        }

        xml += `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Purchase Account</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>-${purchase.subtotal.toFixed(2)}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>`
      }

      // Export Expenses as Journal Vouchers
      for (const expense of expenses) {
        const expenseDate = formatTallyDate(expense.date)
        xml += `
        <VOUCHER VCHTYPE="Journal" ACTION="Create">
          <DATE>${expenseDate}</DATE>
          <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>
          <NARRATION>${escapeXml(expense.category)}: ${escapeXml(expense.description)}${expense.notes ? '. ' + escapeXml(expense.notes) : ''}</NARRATION>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(expense.category)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>${expense.amount.toFixed(2)}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Cash</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>-${expense.amount.toFixed(2)}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>`
      }

      // Export Debtors as Ledger Masters
      for (const debtor of debtors) {
        xml += `
        <LEDGER NAME="${escapeXml(debtor.name)}" ACTION="Create">
          <NAME>${escapeXml(debtor.name)}</NAME>
          <PARENT>Sundry Debtors</PARENT>
          <OPENINGBALANCE>${debtor.openingBalance.toFixed(2)}</OPENINGBALANCE>
        </LEDGER>`
      }

      // Export Creditors as Ledger Masters
      for (const creditor of creditors) {
        xml += `
        <LEDGER NAME="${escapeXml(creditor.name)}" ACTION="Create">
          <NAME>${escapeXml(creditor.name)}</NAME>
          <PARENT>Sundry Creditors</PARENT>
          <OPENINGBALANCE>${creditor.openingBalance.toFixed(2)}</OPENINGBALANCE>
        </LEDGER>`
      }

      // Export Inventory as Stock Items
      for (const item of inventory) {
        xml += `
        <STOCKITEM NAME="${escapeXml(item.name)}" ACTION="Create">
          <NAME>${escapeXml(item.name)}</NAME>
          <PARENT>${escapeXml(item.category || 'General')}</PARENT>
          <OPENINGSTOCK>${item.openingStock.toFixed(2)}</OPENINGSTOCK>
          <STANDARDPRICELIST.LIST>
            <STANDARDPRICE>${item.salePrice.toFixed(2)}</STANDARDPRICE>
          </STANDARDPRICELIST.LIST>
        </STOCKITEM>`
      }

      xml += `
      </TALLYMESSAGE>
    </DESC>
  </BODY>
</ENVELOPE>`

      return new NextResponse(xml, {
        headers: {
          'Content-Type': 'application/xml',
          'Content-Disposition': `attachment; filename="${tenant.name.replace(/[^a-zA-Z0-9]/g, '_')}_tally_export.xml"`,
        },
      })
    }

    return NextResponse.json({ error: 'Invalid action. Use: json, tally, csv' }, { status: 400 })
  } catch (error) {
    console.error('Backup error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Helper: Escape XML special characters
function escapeXml(str: string): string {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Helper: Format date to Tally format (YYYYMMDD)
function formatTallyDate(date: Date): string {
  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

// Helper: Safely parse JSON
function safeParseJson(str: string): any[] {
  try {
    return JSON.parse(str)
  } catch {
    return []
  }
}
