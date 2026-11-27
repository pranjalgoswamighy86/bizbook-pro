import { NextRequest, NextResponse } from 'next/server'
import { requireAuthAndTenant, requireTenantRole, writeAuditLog } from '@/lib/api-helpers'
import { db } from '@/lib/db-soft-delete'
import {
  validateGSTIN,
  validateHSN,
  getStateCode,
  isInterStateSupply,
  calculateItemGST,
  calculateInvoiceTotals,
  allocateInvoiceDiscountToItems,
  getFinancialYear,
  formatDateForEinvoice,
  roundTo2,
  extractPinCode,
} from '@/lib/gst-utils'
// v4.152: IRP direct integration
import { submitToIrp, cancelIrn, getIrpBaseUrl } from '@/lib/irp-integration'
import { getEffectiveGspConfig } from '@/lib/gsp-credentials'

// Sale items may store GST as one GST entry (18%) or split CGST + SGST
// entries (9% + 9%). IRP needs the combined GST rate.
function getItemGstRate(item: Record<string, any>): number {
  const taxes = Array.isArray(item.taxes) ? item.taxes : []
  const gstTaxes = taxes.filter((tax: any) =>
    ['GST', 'CGST', 'SGST', 'IGST'].includes(String(tax?.name || '').trim().toUpperCase())
  )
  if (gstTaxes.length > 0) {
    return gstTaxes.reduce((sum: number, tax: any) => sum + Number(tax?.percent || 0), 0)
  }
  return Number(item.gstRate || 0)
}

// ============================================================
// GST E-Invoice API
// Generates INV-01 compliant JSON payload for IRP submission
// Supports: payload generation, status tracking, cancellation
// ============================================================


export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body
    const requestedTenantId = typeof body?.tenantId === 'string' ? body.tenantId : ''
    if (!requestedTenantId) return NextResponse.json({ error: 'No business selected' }, { status: 400 })

    // Authenticate and verify tenant membership before ANY read or write action.
    const requestAccess = await requireAuthAndTenant(req, requestedTenantId)
    if (requestAccess instanceof NextResponse) return requestAccess
    const tenantId = requestAccess.tenantId

    const writeActions = ['update-status', 'cancel', 'submit-to-irp', 'update-purchase-status', 'cancel-irp']
    if (writeActions.includes(action)) {
      const roleAccess = await requireTenantRole(requestAccess.userId, tenantId, ['DATA_ENTRY', 'JUNIOR_ADMIN', 'MAIN_ADMIN'])
      if (roleAccess instanceof NextResponse) return roleAccess
    }

    if (action === 'generate-payload') {
      // Generate e-invoice JSON payload (INV-01 schema) for a sale
      const { saleId } = body
      if (!saleId) {
        return NextResponse.json({ error: 'Sale ID required' }, { status: 400 })
      }

      const sale = await db.sale.findFirst({ where: { id: saleId, tenantId, isDeleted: false } })
      if (!sale || sale.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
      }

      const tenant = await db.tenant.findFirst({ where: { id: tenantId, isDeleted: false } })
      if (!tenant) {
        return NextResponse.json({ error: 'Business not found' }, { status: 404 })
      }

      // Validate mandatory GST fields
      if (!tenant.gstNumber) {
        return NextResponse.json({ error: 'Company GSTIN is not configured. Please update Settings.' }, { status: 400 })
      }
      if (!sale.partyGst) {
        return NextResponse.json({ error: 'Buyer GSTIN is missing on this invoice. E-invoicing requires buyer GSTIN.' }, { status: 400 })
      }

      // BUG FIX: Validate GSTIN format for both supplier and buyer
      const supplierGstinValidation = validateGSTIN(tenant.gstNumber)
      if (!supplierGstinValidation.valid) {
        return NextResponse.json({ error: `Invalid supplier GSTIN: ${supplierGstinValidation.error}` }, { status: 400 })
      }

      const buyerGstinValidation = validateGSTIN(sale.partyGst)
      if (!buyerGstinValidation.valid) {
        return NextResponse.json({ error: `Invalid buyer GSTIN: ${buyerGstinValidation.error}` }, { status: 400 })
      }

      // Parse sale items
      let items: Record<string, unknown>[]
      try {
        items = JSON.parse(sale.items || '[]')
      } catch {
        return NextResponse.json({ error: 'Failed to parse invoice items. Please verify the sale data.' }, { status: 400 })
      }
      if (!Array.isArray(items) || items.length === 0) {
        return NextResponse.json({ error: 'Invoice has no items. Add at least one item before generating e-invoice.' }, { status: 400 })
      }

      // BUG FIX: Validate HSN codes for B2B e-invoicing
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const hsnValidation = validateHSN(String(item.hsn || ''), true)
        if (!hsnValidation.valid) {
          return NextResponse.json({
            error: `Item ${i + 1} (${item.name || 'unnamed'}): ${hsnValidation.error}`
          }, { status: 400 })
        }
      }

      // Determine supply type
      const supplierState = getStateCode(tenant.gstNumber)
      const buyerState = getStateCode(sale.partyGst)
      const suppliedSellerPin = typeof body.sellerPinCode === 'string' ? body.sellerPinCode.trim() : ''
      const suppliedBuyerPin = typeof body.buyerPinCode === 'string' ? body.buyerPinCode.trim() : ''
      const supplierPin = extractPinCode(tenant.address) || (/^[1-9]\d{5}$/.test(suppliedSellerPin) ? Number(suppliedSellerPin) : null)
      const buyerPin = extractPinCode(sale.partyAddress) || (/^[1-9]\d{5}$/.test(suppliedBuyerPin) ? Number(suppliedBuyerPin) : null)
      const missingPins = [
        ...(!supplierPin ? ['seller'] : []),
        ...(!buyerPin ? ['buyer'] : []),
      ]
      if (missingPins.length) {
        return NextResponse.json({
          code: 'PIN_CODE_REQUIRED',
          missingPins,
          error: `A valid six-digit PIN code is missing for the ${missingPins.join(' and ')} address. Enter the PIN shown on the registered business/customer address to continue.`,
        }, { status: 400 })
      }
      const isInterState = isInterStateSupply(tenant.gstNumber, sale.partyGst)

      // BUG FIX: SupTyp should correctly reflect supply type
      // For B2B, it's always 'B2B' regardless of intra/inter-state
      // The distinction is made through tax components (IGST vs CGST+SGST)
      // Other valid values: 'SEZWP', 'SEZWOP', 'EXPWP', 'EXPWOP', 'DEXP'
      const supType = 'B2B'

      // BUG FIX: Calculate item-level GST properly with reconciliation
      let discountAllocation: ReturnType<typeof allocateInvoiceDiscountToItems>
      try {
        discountAllocation = allocateInvoiceDiscountToItems(
          items.map(item => ({ qty: Number(item.qty) || 0, rate: Number(item.rate) || 0, discount: Number(item.discount || 0) })),
          Number(sale.discountPercent || 0),
          sale.subtotal,
        )
      } catch (error: any) {
        return NextResponse.json({ error: error.message || 'Sale discount/taxable value does not reconcile. Correct the invoice before generating the e-invoice.' }, { status: 422 })
      }

      const calculatedItems = items.map((item: Record<string, unknown>, idx: number) => {
        const qty = Number(item.qty) || 0
        const rate = Number(item.rate) || 0
        const discount = discountAllocation.lineDiscounts[idx]
        const gstRt = getItemGstRate(item)

        // BUG FIX: Calculate GST from assessable value and rate, not from pre-calculated totalTax
        // This ensures correct tax computation and proper CGST/SGST/IGST split
        const itemGST = calculateItemGST(qty, rate, gstRt, discount, isInterState)

        return {
          SlNo: String(idx + 1),
          PrdDesc: String(item.name || ''),
          IsServc: item.saleItemType === 'SERVICE' ? 'Y' : 'N',
          HsnCd: String(item.hsn || ''),
          Qty: qty,
          Unit: String(item.unit || 'PCS'),
          UnitPrice: roundTo2(rate),
          TotAmt: itemGST.totAmt,
          Discount: roundTo2(discount),
          AssAmt: itemGST.assAmt,
          GstRt: gstRt,
          CgstAmt: itemGST.cgstAmt,
          SgstAmt: itemGST.sgstAmt,
          IgstAmt: itemGST.igstAmt,
          CesRt: 0,
          CesAmt: 0,
          OthChrg: 0,
          // BUG FIX: TotItemVal must equal AssAmt + CgstAmt + SgstAmt + IgstAmt (after rounding)
          // Previously used assVal + gstAmt which could mismatch after rounding
          TotItemVal: itemGST.totItemVal,
        }
      })

      // BUG FIX: Calculate invoice-level totals from item-level values for reconciliation
      // Previously used sale.subtotal and sale.gstAmount directly which may not match
      // the sum of item-level computed values after rounding
      const invoiceTotals = calculateInvoiceTotals(
        calculatedItems.map(item => ({
          assAmt: item.AssAmt,
          cgstAmt: item.CgstAmt,
          sgstAmt: item.SgstAmt,
          igstAmt: item.IgstAmt,
        })),
        sale.totalAmount
      )

      const calculatedGstTotal = roundTo2(invoiceTotals.cgstVal + invoiceTotals.sgstVal + invoiceTotals.igstVal)
      if (Math.abs(calculatedGstTotal - roundTo2(sale.gstAmount || 0)) > 1) {
        return NextResponse.json({ error: 'Calculated item GST does not reconcile with the saved invoice GST. Correct the sale before generating the e-invoice.' }, { status: 422 })
      }
      if (Math.abs(invoiceTotals.rndOffAmt) > 0.5) {
        return NextResponse.json({ error: 'E-invoice values do not reconcile to the saved invoice total. The difference is too large to treat as rounding; correct the sale before submission.' }, { status: 422 })
      }

      // Build the INV-01 compliant payload
      const payload = {
        Version: '1.1',
        TranDtls: {
          TaxSch: 'GST',
          SupTyp: supType,
          RegRev: 'N',
          EcmGstin: null,
        },
        DocDtls: {
          Typ: 'INV',
          No: sale.invoiceNumber,
          Dt: formatDateForEinvoice(sale.date),
        },
        SellerDtls: {
          Gstin: tenant.gstNumber,
          LglNm: tenant.name,
          TrdNm: tenant.name,
          Addr1: tenant.address || '',
          Loc: '',
          Pin: supplierPin,
          Stcd: supplierState,
        },
        BuyerDtls: {
          Gstin: sale.partyGst,
          LglNm: sale.partyName,
          TrdNm: sale.partyName,
          Addr1: sale.partyAddress || '',
          Loc: '',
          Pin: buyerPin,
          Pos: buyerState,
          Stcd: buyerState,
        },
        ItemList: calculatedItems,
        ValDtls: {
          AssVal: invoiceTotals.assVal,
          CgstVal: invoiceTotals.cgstVal,
          SgstVal: invoiceTotals.sgstVal,
          IgstVal: invoiceTotals.igstVal,
          CesVal: invoiceTotals.cesVal,
          StCesVal: invoiceTotals.stCesVal,
          Discount: invoiceTotals.discount,
          OthChrg: invoiceTotals.othChrg,
          RndOffAmt: invoiceTotals.rndOffAmt,
          TotInvVal: invoiceTotals.totInvVal,
        },
        PayDtls: {
          Nm: sale.partyName,
          Mode: sale.paymentStatus === 'RECEIVED' ? 'Cash' : 'Credit',
          PayTerm: sale.paymentStatus === 'RECEIVED' ? 'Immediate' : 'Credit',
          PaymtDue: sale.paymentStatus === 'RECEIVED' ? 0 : sale.totalAmount - (sale.amountReceived || 0),
        },
      }

      const finYear = getFinancialYear(new Date(sale.date))

      return NextResponse.json({
        payload,
        metadata: {
          saleId: sale.id,
          invoiceNumber: sale.invoiceNumber,
          finYear,
          supplierGstin: tenant.gstNumber,
          buyerGstin: sale.partyGst,
          isInterState,
          generatedAt: new Date().toISOString(),
        }
      })
    }

    if (action === 'update-status') {
      // v6.27.5: SECURITY FIX — add authentication. Previously this action
      // had no auth check, allowing anyone to overwrite the IRN/AckNo/Status
      // on any sale in any tenant.
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      // Update e-invoice status after IRP response
      const { saleId, irn, ackNo, ackDate, qrCodeText, status } = body
      if (!saleId) {
        return NextResponse.json({ error: 'Sale ID required' }, { status: 400 })
      }

      const sale = await db.sale.findFirst({ where: { id: saleId, tenantId, isDeleted: false } })
      if (!sale || sale.tenantId !== access.tenantId) {
        return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
      }

      if (status && status !== 'GENERATED') return NextResponse.json({ error: 'Only GENERATED status can be recorded manually. Cancellation must be confirmed by the IRP.' }, { status: 400 })
      if (typeof irn !== 'string' || !/^[A-Fa-f0-9]{64}$/.test(irn.trim())) return NextResponse.json({ error: 'Enter the 64-character IRN returned by the IRP.' }, { status: 400 })
      if (!ackNo || !ackDate || Number.isNaN(new Date(ackDate).getTime())) return NextResponse.json({ error: 'Valid IRP acknowledgement number and date are required.' }, { status: 400 })

      const updateData: {
        einvoiceStatus?: string
        einvoiceIrn?: string | null
        einvoiceAckNo?: string | null
        einvoiceAckDate?: string | null
        einvoiceQrCodeText?: string | null
      } = { // v6.30.2: FIX TS2322 — was Record<string, unknown> (too loose for Prisma Exact type)
        einvoiceStatus: 'GENERATED',
      }
      updateData.einvoiceIrn = irn.trim().toUpperCase()
      if (ackNo) updateData.einvoiceAckNo = ackNo
      if (ackDate) updateData.einvoiceAckDate = ackDate
      if (qrCodeText) updateData.einvoiceQrCodeText = qrCodeText

      const updated = await db.sale.update({
        where: { id: saleId, tenantId, isDeleted: false },
        data: updateData,
      })

      return NextResponse.json({ sale: updated })
    }

    if (action === 'cancel') {
      // Never mark an IRN cancelled locally unless the IRP confirms it.
      const { saleId, reason } = body
      if (!saleId) return NextResponse.json({ error: 'Sale ID required' }, { status: 400 })
      const reasonCode = String(reason || '1')
      if (!/^[1-6]$/.test(reasonCode)) return NextResponse.json({ error: 'Invalid IRP cancellation reason. Use a reason code from 1 to 6.' }, { status: 400 })
      const sale = await db.sale.findFirst({ where: { id: saleId, tenantId, isDeleted: false } })
      if (!sale || sale.tenantId !== tenantId) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
      if (!sale.einvoiceIrn || sale.einvoiceStatus !== 'GENERATED') return NextResponse.json({ error: 'Only an active IRP-generated invoice can be cancelled.' }, { status: 400 })
      if (!sale.einvoiceAckDate) return NextResponse.json({ error: 'Acknowledgement date is missing; verify the IRP record before cancellation.' }, { status: 400 })
      const hoursDiff = (Date.now() - new Date(sale.einvoiceAckDate).getTime()) / (1000 * 60 * 60)
      if (!Number.isFinite(hoursDiff) || hoursDiff < 0 || hoursDiff > 24) {
        return NextResponse.json({ error: 'The IRP 24-hour cancellation window has expired or the acknowledgement date is invalid. Issue a credit note instead.' }, { status: 400 })
      }
      const gspConfig = await getEffectiveGspConfig(tenantId)
      const result = await cancelIrn(sale.einvoiceIrn, reasonCode, gspConfig)
      if (!result.success) return NextResponse.json({ success: false, mode: result.mode, error: result.errorMessage || 'IRP cancellation failed' }, { status: 502 })
      const updated = await db.sale.update({ where: { id: saleId, tenantId, isDeleted: false }, data: { einvoiceStatus: 'CANCELLED' } })
      await writeAuditLog({
        tenantId, userId: requestAccess.userId, userName: requestAccess.user?.name || 'Unknown',
        action: 'UPDATE', entityType: 'E-Invoice', entityId: saleId,
        entityName: `IRN cancelled for ${sale.invoiceNumber}`,
        changes: { irn: sale.einvoiceIrn, reason: reasonCode },
      })
      return NextResponse.json({ success: true, sale: updated })
    }

    if (action === 'generate-purchase-payload') {
      // Purchases are supplier-issued invoices; BizBook Pro records the IRN
      // supplied by the vendor and must never generate one on the buyer's behalf.
      return NextResponse.json({
        error: 'A supplier must generate the IRN for a purchase invoice. Enter the supplier-issued IRN and acknowledgement details instead.',
        code: 'SUPPLIER_ISSUED_EINVOICE',
      }, { status: 400 })
    }

    if (action === 'update-purchase-status') {
      // v6.27.5: SECURITY FIX — add authentication (was missing).
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      const { purchaseId, irn, ackNo, ackDate, qrCodeText, status } = body
      if (!purchaseId) return NextResponse.json({ error: 'Purchase ID required' }, { status: 400 })

      const purchase = await db.purchase.findFirst({ where: { id: purchaseId, tenantId: access.tenantId, isDeleted: false } })
      if (!purchase || purchase.tenantId !== access.tenantId) return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })

      if (status && status !== 'GENERATED') return NextResponse.json({ error: 'Only GENERATED status can be recorded for a supplier-issued IRN.' }, { status: 400 })
      if (typeof irn !== 'string' || !/^[A-Fa-f0-9]{64}$/.test(irn.trim())) return NextResponse.json({ error: 'Enter the 64-character IRN supplied by the vendor.' }, { status: 400 })
      if (!ackNo || !ackDate || Number.isNaN(new Date(ackDate).getTime())) return NextResponse.json({ error: 'Valid supplier acknowledgement number and date are required.' }, { status: 400 })

      const updateData: {
        einvoiceStatus?: string
        einvoiceIrn?: string | null
        einvoiceAckNo?: string | null
        einvoiceAckDate?: string | null
        einvoiceQrCodeText?: string | null
      } = { einvoiceStatus: 'GENERATED' }
      updateData.einvoiceIrn = irn.trim().toUpperCase()
      if (ackNo) updateData.einvoiceAckNo = ackNo
      if (ackDate) updateData.einvoiceAckDate = ackDate
      if (qrCodeText) updateData.einvoiceQrCodeText = qrCodeText

      const updated = await db.purchase.update({ where: { id: purchaseId, tenantId: access.tenantId, isDeleted: false }, data: updateData })
      return NextResponse.json({ purchase: updated })
    }

    if (action === 'status') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      // Get e-invoice status for a sale or purchase
      const { type, id } = body
      if (!type || !id) return NextResponse.json({ error: 'Type and ID required' }, { status: 400 })

      if (type === 'sale') {
        const sale = await db.sale.findFirst({
          where: { id, tenantId, isDeleted: false },
          select: {
            tenantId: true, einvoiceIrn: true, einvoiceAckNo: true, einvoiceAckDate: true,
            einvoiceQrCodeText: true, einvoiceStatus: true, invoiceNumber: true,
          }
        })
        if (!sale || sale.tenantId !== tenantId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
        return NextResponse.json({ einvoice: sale })
      }

      if (type === 'purchase') {
        const purchase = await db.purchase.findFirst({
          where: { id, tenantId, isDeleted: false },
          select: {
            tenantId: true, einvoiceIrn: true, einvoiceAckNo: true, einvoiceAckDate: true,
            einvoiceQrCodeText: true, einvoiceStatus: true, invoiceNumber: true,
          }
        })
        if (!purchase || purchase.tenantId !== tenantId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
        return NextResponse.json({ einvoice: purchase })
      }

      return NextResponse.json({ error: 'Invalid type. Use "sale" or "purchase"' }, { status: 400 })
    }

    // ============================================================
    // v4.152: SUBMIT-TO-IRP — direct IRP API call for IRN generation
    // ============================================================
    if (action === 'submit-to-irp') {
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      const { saleId } = body
      if (!saleId) return NextResponse.json({ error: 'Sale ID required' }, { status: 400 })

      const sale = await db.sale.findFirst({ where: { id: saleId, tenantId, isDeleted: false } })
      if (!sale || sale.tenantId !== tenantId) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })

      // Already submitted?
      if (sale.einvoiceIrn && sale.einvoiceStatus === 'GENERATED') {
        return NextResponse.json({
          error: `E-invoice already generated. IRN: ${sale.einvoiceIrn}`,
          existingIrn: sale.einvoiceIrn,
          existingAckNo: sale.einvoiceAckNo,
        }, { status: 400 })
      }

      const tenant = await db.tenant.findFirst({ where: { id: tenantId, isDeleted: false } })
      if (!tenant?.gstNumber) {
        return NextResponse.json({ error: 'Company GSTIN not configured. Update Settings first.' }, { status: 400 })
      }

      // Build the INV-01 payload (reuses existing logic from generate-payload)
      // For brevity, we'll call the internal helper — in a refactor this would be extracted
      let items: any[]
      try {
        items = JSON.parse(sale.items || '[]')
      } catch {
        return NextResponse.json({ error: 'Invoice item data is invalid. Reopen and save the invoice before generating an IRN.' }, { status: 400 })
      }
      const buyerGstin = sale.partyGst || ''
      const sellerValidation = validateGSTIN(tenant.gstNumber)
      const buyerValidation = validateGSTIN(buyerGstin)
      if (!sellerValidation.valid || !buyerValidation.valid) {
        return NextResponse.json({ error: `Valid seller and buyer GSTINs are required. ${!sellerValidation.valid ? `Seller: ${sellerValidation.error}` : `Buyer: ${buyerValidation.error}`}` }, { status: 400 })
      }
      if (!Array.isArray(items) || items.length === 0) return NextResponse.json({ error: 'Invoice must contain at least one item.' }, { status: 400 })
      const suppliedSellerPin = typeof body.sellerPinCode === 'string' ? body.sellerPinCode.trim() : ''
      const suppliedBuyerPin = typeof body.buyerPinCode === 'string' ? body.buyerPinCode.trim() : ''
      const sellerPin = extractPinCode(tenant.address) || (/^[1-9]\d{5}$/.test(suppliedSellerPin) ? Number(suppliedSellerPin) : null)
      const buyerPin = extractPinCode(sale.partyAddress) || (/^[1-9]\d{5}$/.test(suppliedBuyerPin) ? Number(suppliedBuyerPin) : null)
      const missingPins = [
        ...(!sellerPin ? ['seller'] : []),
        ...(!buyerPin ? ['buyer'] : []),
      ]
      if (missingPins.length) {
        return NextResponse.json({
          code: 'PIN_CODE_REQUIRED',
          missingPins,
          error: `A valid six-digit PIN code is missing for the ${missingPins.join(' and ')} address. Enter the PIN shown on the registered business/customer address to continue.`,
        }, { status: 400 })
      }
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const validation = validateHSN(String(item?.hsn || ''), true)
        if (!validation.valid) return NextResponse.json({ error: `Item ${i + 1}: ${validation.error}` }, { status: 400 })
        const qty = Number(item?.qty)
        const rate = Number(item?.rate)
        const gstRate = getItemGstRate(item)
        const discount = Number(item?.discount || 0)
        if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(rate) || rate < 0 ||
            !Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100 ||
            !Number.isFinite(discount) || discount < 0 || discount > qty * rate) {
          return NextResponse.json({ error: `Item ${i + 1} has invalid quantity, rate, GST rate, or discount.` }, { status: 400 })
        }
      }

      const interState = isInterStateSupply(tenant.gstNumber, buyerGstin)
      const itemDetails = items.map((item: any, i: number) => {
        const gst = calculateItemGST(
          Number(item.qty || 0),
          Number(item.rate || 0),
          getItemGstRate(item),
          Number(item.discount || 0),
          interState
        )
        return {
          SlNo: String(i + 1),
          PrdDesc: item.name || 'Item',
          IsServc: item.saleItemType === 'SERVICE' ? 'Y' : 'N',
          HsnCd: item.hsn || '0000',
          Unit: item.unit || 'OTH',
          Qty: Number(item.qty || 0),
          UnitPrice: roundTo2(Number(item.rate || 0)),
          TotAmt: gst.totAmt,
          Discount: roundTo2(Number(item.discount || 0)),
          AssAmt: gst.assAmt,
          GstRt: getItemGstRate(item),
          IgstAmt: gst.igstAmt,
          CgstAmt: gst.cgstAmt,
          SgstAmt: gst.sgstAmt,
          CesRt: 0, CesAmt: 0, CesNonAdvlAmt: 0,
          TotItemVal: gst.totItemVal,
        }
      })

      const totals = calculateInvoiceTotals(
        itemDetails.map(i => ({ assAmt: i.AssAmt, cgstAmt: i.CgstAmt, sgstAmt: i.SgstAmt, igstAmt: i.IgstAmt })),
        roundTo2(sale.totalAmount)
      )

      const inv01Payload = {
        Version: '1.1',
        // v6.29.3: SupTyp ternary was dead code (both branches 'B2B'). The
        // earlier validateGSTIN guard already ensured buyerGstin is a valid
        // 15-char GSTIN, so this path is by definition B2B. For SEZ / export
        // / unregistered B2C, the route returns a 400 before reaching here.
        TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N' },
        DocDtls: { Typ: 'INV', No: sale.invoiceNumber, Dt: formatDateForEinvoice(sale.date) },
        SellerDtls: {
          Gstin: tenant.gstNumber,
          LglNm: tenant.name,
          Addr1: tenant.address || '',
          Pin: sellerPin,
          Stcd: getStateCode(tenant.gstNumber),
        },
        BuyerDtls: {
          Gstin: buyerGstin,
          LglNm: sale.partyName,
          Addr1: sale.partyAddress || '',
          Pin: buyerPin,
          Stcd: getStateCode(buyerGstin),
          Pos: getStateCode(buyerGstin),
        },
        ItemList: itemDetails,
        ValDtls: {
          AssVal: totals.assVal,
          CgstVal: totals.cgstVal,
          SgstVal: totals.sgstVal,
          IgstVal: totals.igstVal,
          CesVal: totals.cesVal,
          StCesVal: totals.stCesVal,
          Discount: totals.discount,
          OthChrg: totals.othChrg,
          RndOffAmt: totals.rndOffAmt,
          TotInvVal: totals.totInvVal,
        },
        PayDtls: { CrDay: 0, PaidAmt: roundTo2(sale.amountReceived || 0), PaymtDue: roundTo2(sale.totalAmount - (sale.amountReceived || 0)) },
      }

      // Submit to IRP
      const gspConfig = await getEffectiveGspConfig(tenantId)
      const irpResult = await submitToIrp(inv01Payload, gspConfig)

      if (irpResult.success && irpResult.irn) {
        // Persist IRN + AckNo + AckDate + SignedQR
        const updated = await db.sale.update({
          where: { id: saleId, tenantId, isDeleted: false },
          data: {
            einvoiceIrn: irpResult.irn,
            einvoiceAckNo: irpResult.ackNo,
            einvoiceAckDate: irpResult.ackDate,
            einvoiceQrCodeText: irpResult.signedQrCode,
            einvoiceStatus: 'GENERATED',
          },
        })

        await writeAuditLog({
          tenantId,
          userId: access.userId,
          userName: access.user?.name || 'Unknown',
          action: 'CREATE',
          entityType: 'E-Invoice',
          entityName: `IRN generated: ${irpResult.irn.slice(0, 16)}... for ${sale.invoiceNumber}`,
          changes: { saleId, irn: irpResult.irn, ackNo: irpResult.ackNo, mode: 'LIVE' },
        })

        return NextResponse.json({
          success: true,
          mode: 'LIVE',
          irn: irpResult.irn,
          ackNo: irpResult.ackNo,
          ackDate: irpResult.ackDate,
          signedQrCode: irpResult.signedQrCode,
          sale: updated,
        })
      }

      // Either MANUAL mode or LIVE error
      return NextResponse.json({
        success: false,
        mode: irpResult.mode,
        error: irpResult.errorMessage,
        // For MANUAL mode, return the payload so frontend can show it for copy-paste
        inv01Payload: irpResult.mode === 'MANUAL' ? inv01Payload : undefined,
      }, { status: irpResult.mode === 'MANUAL' ? 200 : 400 })
    }

    // ============================================================
    // v4.152: CANCEL-IRN — direct IRP cancellation (within 24h)
    // ============================================================
    if (action === 'cancel-irp') {
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      const { saleId, reason } = body
      if (!saleId) return NextResponse.json({ error: 'Sale ID required' }, { status: 400 })

      const sale = await db.sale.findFirst({ where: { id: saleId, tenantId, isDeleted: false } })
      if (!sale || sale.tenantId !== tenantId) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })

      if (!sale.einvoiceIrn) {
        return NextResponse.json({ error: 'No IRN exists for this sale' }, { status: 400 })
      }

      // IRP cancellation is permitted only for an active IRN inside 24 hours.
      if (sale.einvoiceStatus !== 'GENERATED' || !sale.einvoiceAckDate) {
        return NextResponse.json({ error: 'Only an active IRP-generated invoice with an acknowledgement date can be cancelled.' }, { status: 400 })
      }
      const ackDate = new Date(sale.einvoiceAckDate)
      const hoursDiff = (Date.now() - ackDate.getTime()) / (1000 * 60 * 60)
      if (!Number.isFinite(hoursDiff) || hoursDiff < 0 || hoursDiff > 24) {
        return NextResponse.json({
          error: 'The IRP 24-hour cancellation window has expired or the acknowledgement date is invalid. Issue a credit note instead.',
        }, { status: 400 })
      }
      const reasonCode = String(reason || '1')
      if (!/^[1-6]$/.test(reasonCode)) {
        return NextResponse.json({ error: 'Invalid IRP cancellation reason. Use a reason code from 1 to 6.' }, { status: 400 })
      }

      const cancelResult = await cancelIrn(sale.einvoiceIrn, reasonCode, await getEffectiveGspConfig(tenantId))

      if (cancelResult.success) {
        const updated = await db.sale.update({
          where: { id: saleId, tenantId, isDeleted: false },
          data: { einvoiceStatus: 'CANCELLED' },
        })

        await writeAuditLog({
          tenantId,
          userId: access.userId,
          userName: access.user?.name || 'Unknown',
          action: 'DELETE',
          entityType: 'E-Invoice',
          entityName: `IRN cancelled: ${sale.einvoiceIrn?.slice(0, 16)}...`,
          changes: { saleId, irn: sale.einvoiceIrn, reason },
        })

        return NextResponse.json({ success: true, sale: updated })
      }

      return NextResponse.json({
        success: false,
        mode: cancelResult.mode,
        error: cancelResult.errorMessage,
      }, { status: 400 })
    }

    // ============================================================
    // v4.152: IRP-STATUS — check if IRP is configured
    // ============================================================
    if (action === 'irp-status') {
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      const gspConfig = await getEffectiveGspConfig(tenantId)
      return NextResponse.json({
        configured: !!gspConfig,
        mode: gspConfig ? 'LIVE' : 'MANUAL',
        env: gspConfig?.irpEnv || 'sandbox',
        baseUrl: gspConfig ? getIrpBaseUrl(gspConfig) : null,
        gspCode: gspConfig?.gspCode || null,
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: unknown) {
    console.error('E-Invoice error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}