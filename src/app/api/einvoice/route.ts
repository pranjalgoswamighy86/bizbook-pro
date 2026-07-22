import { NextRequest, NextResponse } from 'next/server'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'
import { db } from '@/lib/db-soft-delete'
import { createHash } from 'crypto'
import {
  STATE_CODES,
  validateGSTIN,
  validateHSN,
  getStateCode,
  isInterStateSupply,
  calculateItemGST,
  calculateInvoiceTotals,
  getFinancialYear,
  formatDateForEinvoice,
  roundTo2,
} from '@/lib/gst-utils'
// v4.152: IRP direct integration
import { submitToIrp, cancelIrn, isIrpConfigured, getIrpBaseUrl } from '@/lib/irp-integration'

// ============================================================
// GST E-Invoice API
// Generates INV-01 compliant JSON payload for IRP submission
// Supports: payload generation, status tracking, cancellation
// ============================================================

function generateIRNHash(gstin: string, finYear: string, docType: string, docNo: string): string {
  // Generate a deterministic 64-char hash for IRN based on primary keys
  // In production, this would be SHA-256; here we create a consistent hash
  const raw = `${gstin}|${finYear}|${docType}|${docNo}`
  return createHash('sha256').update(raw).digest('hex')
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    if (!tenantId) {
      return NextResponse.json({ error: 'No business selected' }, { status: 400 })
    }

    if (action === 'generate-payload') {
      // Generate e-invoice JSON payload (INV-01 schema) for a sale
      const { saleId } = body
      if (!saleId) {
        return NextResponse.json({ error: 'Sale ID required' }, { status: 400 })
      }

      const sale = await db.sale.findUnique({ where: { id: saleId } })
      if (!sale || sale.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
      }

      const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
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
      const isInterState = isInterStateSupply(tenant.gstNumber, sale.partyGst)

      // BUG FIX: SupTyp should correctly reflect supply type
      // For B2B, it's always 'B2B' regardless of intra/inter-state
      // The distinction is made through tax components (IGST vs CGST+SGST)
      // Other valid values: 'SEZWP', 'SEZWOP', 'EXPWP', 'EXPWOP', 'DEXP'
      const supType = 'B2B'

      // BUG FIX: Calculate item-level GST properly with reconciliation
      const calculatedItems = items.map((item: Record<string, unknown>, idx: number) => {
        const qty = Number(item.qty) || 0
        const rate = Number(item.rate) || 0
        const discount = Number(item.discount || 0)
        const gstRt = Number(item.taxes?.[0]?.percent || item.gstRate || 0)

        // BUG FIX: Calculate GST from assessable value and rate, not from pre-calculated totalTax
        // This ensures correct tax computation and proper CGST/SGST/IGST split
        const itemGST = calculateItemGST(qty, rate, gstRt, discount, isInterState)

        return {
          SlNo: String(idx + 1),
          PrdNm: String(item.name || ''),
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
        SupDtls: {
          Gstin: tenant.gstNumber,
          LglNm: tenant.name,
          TrdNm: tenant.name,
          Addr1: tenant.address || '',
          Loc: '',
          Pin: 0,
          Stcd: supplierState,
        },
        RecDtls: {
          Gstin: sale.partyGst,
          LglNm: sale.partyName,
          TrdNm: sale.partyName,
          Addr1: sale.partyAddress || '',
          Loc: '',
          Pin: 0,
          Pos: buyerState,
          Stcd: buyerState,
        },
        ItemList: calculatedItems,
        ValDtls: invoiceTotals,
        PayDtls: {
          Nm: sale.partyName,
          Mode: sale.paymentStatus === 'RECEIVED' ? 'Cash' : 'Credit',
          PayTerm: sale.paymentStatus === 'RECEIVED' ? 'Immediate' : 'Credit',
          PayDue: sale.paymentStatus === 'RECEIVED' ? 0 : sale.totalAmount - (sale.amountReceived || 0),
        },
      }

      // Generate IRN hash
      const finYear = getFinancialYear(new Date(sale.date))
      const irnHash = generateIRNHash(tenant.gstNumber, finYear, 'INV', sale.invoiceNumber)

      return NextResponse.json({
        payload,
        irnHash,
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

      const sale = await db.sale.findUnique({ where: { id: saleId } })
      if (!sale || sale.tenantId !== access.tenantId) {
        return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
      }

      const updateData: Record<string, unknown> = {
        einvoiceStatus: status || 'GENERATED',
      }
      if (irn) updateData.einvoiceIrn = irn
      if (ackNo) updateData.einvoiceAckNo = ackNo
      if (ackDate) updateData.einvoiceAckDate = ackDate
      if (qrCodeText) updateData.einvoiceQrCodeText = qrCodeText

      const updated = await db.sale.update({
        where: { id: saleId },
        data: updateData,
      })

      return NextResponse.json({ sale: updated })
    }

    if (action === 'cancel') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      // Mark e-invoice as cancelled (within 24-hour window)
      const { saleId, reason } = body
      if (!saleId) {
        return NextResponse.json({ error: 'Sale ID required' }, { status: 400 })
      }

      const sale = await db.sale.findUnique({ where: { id: saleId } })
      if (!sale || sale.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
      }

      if (sale.einvoiceStatus !== 'GENERATED') {
        return NextResponse.json({ error: 'Only generated e-invoices can be cancelled' }, { status: 400 })
      }

      // Check 24-hour window
      if (sale.einvoiceAckDate) {
        const ackDate = new Date(sale.einvoiceAckDate)
        const hoursDiff = (Date.now() - ackDate.getTime()) / (1000 * 60 * 60)
        if (hoursDiff > 24) {
          return NextResponse.json({
            error: `Cannot cancel e-invoice: 24-hour cancellation window has expired (${hoursDiff.toFixed(1)} hours since generation). Issue a Credit Note instead.`
          }, { status: 400 })
        }
      }

      const updated = await db.sale.update({
        where: { id: saleId },
        data: {
          einvoiceStatus: 'CANCELLED',
        }
      })

      return NextResponse.json({ sale: updated })
    }

    if (action === 'generate-purchase-payload') {
      // Generate e-invoice JSON payload for a purchase
      const { purchaseId } = body
      if (!purchaseId) {
        return NextResponse.json({ error: 'Purchase ID required' }, { status: 400 })
      }

      const purchase = await db.purchase.findUnique({ where: { id: purchaseId } })
      if (!purchase || purchase.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })
      }

      const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
      if (!tenant) {
        return NextResponse.json({ error: 'Business not found' }, { status: 404 })
      }

      if (!tenant.gstNumber || !purchase.partyGst) {
        return NextResponse.json({ error: 'Both company and supplier GSTIN are required for e-invoicing' }, { status: 400 })
      }

      // BUG FIX: Validate GSTIN format for both supplier and buyer
      const supplierGstinValidation = validateGSTIN(purchase.partyGst)
      if (!supplierGstinValidation.valid) {
        return NextResponse.json({ error: `Invalid supplier GSTIN: ${supplierGstinValidation.error}` }, { status: 400 })
      }

      const buyerGstinValidation = validateGSTIN(tenant.gstNumber)
      if (!buyerGstinValidation.valid) {
        return NextResponse.json({ error: `Invalid buyer GSTIN: ${buyerGstinValidation.error}` }, { status: 400 })
      }

      let items: Record<string, unknown>[]
      try {
        items = JSON.parse(purchase.items || '[]')
      } catch {
        return NextResponse.json({ error: 'Failed to parse purchase items. Please verify the purchase data.' }, { status: 400 })
      }
      if (!Array.isArray(items) || items.length === 0) {
        return NextResponse.json({ error: 'Purchase has no items. Add at least one item before generating e-invoice.' }, { status: 400 })
      }
      const supplierState = getStateCode(purchase.partyGst)
      const buyerState = getStateCode(tenant.gstNumber)
      const isInterState = isInterStateSupply(purchase.partyGst, tenant.gstNumber)

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

      // BUG FIX: Calculate item-level GST properly with reconciliation
      const calculatedItems = items.map((item: Record<string, unknown>, idx: number) => {
        const qty = Number(item.qty) || 0
        const rate = Number(item.rate) || 0
        const discount = Number(item.discount || 0)
        const gstRt = Number(item.taxes?.[0]?.percent || item.gstRate || 0)

        // BUG FIX: Calculate GST from assessable value and rate
        const itemGST = calculateItemGST(qty, rate, gstRt, discount, isInterState)

        return {
          SlNo: String(idx + 1),
          PrdNm: String(item.name || ''),
          HsnCd: String(item.hsn || ''),
          Qty: qty,
          Unit: String(item.unit || 'PCS'),
          UnitPrice: roundTo2(rate),
          TotAmt: itemGST.totAmt,
          // BUG FIX: Added missing Discount and AssAmt fields for purchase items
          Discount: roundTo2(discount),
          AssAmt: itemGST.assAmt,
          GstRt: gstRt,
          // BUG FIX: CGST/SGST split now calculated correctly (not naive halving)
          CgstAmt: itemGST.cgstAmt,
          SgstAmt: itemGST.sgstAmt,
          IgstAmt: itemGST.igstAmt,
          CesRt: 0,
          CesAmt: 0,
          OthChrg: 0,
          // BUG FIX: TotItemVal must equal AssAmt + all tax amounts (not totAmt + gstAmt)
          TotItemVal: itemGST.totItemVal,
        }
      })

      // BUG FIX: Calculate invoice-level totals from item-level values
      const invoiceTotals = calculateInvoiceTotals(
        calculatedItems.map(item => ({
          assAmt: item.AssAmt,
          cgstAmt: item.CgstAmt,
          sgstAmt: item.SgstAmt,
          igstAmt: item.IgstAmt,
        })),
        purchase.totalAmount
      )

      const payload = {
        Version: '1.1',
        TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N' },
        DocDtls: {
          Typ: 'INV',
          No: purchase.invoiceNumber,
          Dt: formatDateForEinvoice(purchase.date),
        },
        SupDtls: {
          Gstin: purchase.partyGst,
          LglNm: purchase.partyName,
          Stcd: supplierState,
        },
        RecDtls: {
          Gstin: tenant.gstNumber,
          LglNm: tenant.name,
          Pos: buyerState,
          Stcd: buyerState,
        },
        ItemList: calculatedItems,
        ValDtls: invoiceTotals,
      }

      const finYear = getFinancialYear(new Date(purchase.date))
      const irnHash = generateIRNHash(purchase.partyGst, finYear, 'INV', purchase.invoiceNumber)

      return NextResponse.json({ payload, irnHash, metadata: { purchaseId, isInterState, generatedAt: new Date().toISOString() } })
    }

    if (action === 'update-purchase-status') {
      // v6.27.5: SECURITY FIX — add authentication (was missing).
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      const { purchaseId, irn, ackNo, ackDate, qrCodeText, status } = body
      if (!purchaseId) return NextResponse.json({ error: 'Purchase ID required' }, { status: 400 })

      const purchase = await db.purchase.findUnique({ where: { id: purchaseId } })
      if (!purchase || purchase.tenantId !== access.tenantId) return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })

      const updateData: Record<string, unknown> = { einvoiceStatus: status || 'GENERATED' }
      if (irn) updateData.einvoiceIrn = irn
      if (ackNo) updateData.einvoiceAckNo = ackNo
      if (ackDate) updateData.einvoiceAckDate = ackDate
      if (qrCodeText) updateData.einvoiceQrCodeText = qrCodeText

      const updated = await db.purchase.update({ where: { id: purchaseId }, data: updateData })
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
        const sale = await db.sale.findUnique({
          where: { id },
          select: {
            tenantId: true, einvoiceIrn: true, einvoiceAckNo: true, einvoiceAckDate: true,
            einvoiceQrCodeText: true, einvoiceStatus: true, invoiceNumber: true,
          }
        })
        if (!sale || sale.tenantId !== tenantId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
        return NextResponse.json({ einvoice: sale })
      }

      if (type === 'purchase') {
        const purchase = await db.purchase.findUnique({
          where: { id },
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

      const sale = await db.sale.findUnique({ where: { id: saleId } })
      if (!sale || sale.tenantId !== tenantId) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })

      // Already submitted?
      if (sale.einvoiceIrn && sale.einvoiceStatus === 'GENERATED') {
        return NextResponse.json({
          error: `E-invoice already generated. IRN: ${sale.einvoiceIrn}`,
          existingIrn: sale.einvoiceIrn,
          existingAckNo: sale.einvoiceAckNo,
        }, { status: 400 })
      }

      const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
      if (!tenant?.gstNumber) {
        return NextResponse.json({ error: 'Company GSTIN not configured. Update Settings first.' }, { status: 400 })
      }

      // Build the INV-01 payload (reuses existing logic from generate-payload)
      // For brevity, we'll call the internal helper — in a refactor this would be extracted
      const items = JSON.parse(sale.items || '[]')
      const buyerGstin = sale.partyGst || ''
      if (!buyerGstin || buyerGstin.length !== 15) {
        return NextResponse.json({
          error: 'Buyer GSTIN is required for e-invoice (B2B only). Add buyer GSTIN to the sale.',
        }, { status: 400 })
      }

      const interState = isInterStateSupply(tenant.gstNumber, buyerGstin)
      const itemDetails = items.map((item: any, i: number) => {
        const gst = calculateItemGST(
          Number(item.qty || 0),
          Number(item.rate || 0),
          Number(item.gstRate || 0),
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
          GstRt: Number(item.gstRate || 0),
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
        TranDtls: { TaxSch: 'GST', SupTyp: interState ? 'B2B' : 'B2B', RegRev: 'N' },
        DocDtls: { Typ: 'INV', No: sale.invoiceNumber, Dt: formatDateForEinvoice(sale.date) },
        SellerDtls: {
          Gstin: tenant.gstNumber,
          LglNm: tenant.name,
          Addr1: tenant.address || '',
          Pin: 0,  // TODO: add pinCode to Tenant
          Stcd: getStateCode(tenant.gstNumber),
        },
        BuyerDtls: {
          Gstin: buyerGstin,
          LglNm: sale.partyName,
          Addr1: sale.partyAddress || '',
          Pin: 0,
          Stcd: getStateCode(buyerGstin),
          Pos: getStateCode(buyerGstin),
        },
        ItemList: itemDetails,
        ValDtls: {
          AssVal: totals.assVal,
          CgstVal: totals.cgstVal,
          SgstVal: totals.sgstVal,
          IgstVal: totals.igstVal,
          CesVal: 0,
          RndOffAmt: 0,
          TotInvVal: roundTo2(sale.totalAmount),
        },
        PayDtls: { CrDay: 0, PaidAmt: roundTo2(sale.amountReceived || 0), PaymtDue: roundTo2(sale.totalAmount - (sale.amountReceived || 0)) },
      }

      // Submit to IRP
      const irpResult = await submitToIrp(inv01Payload)

      if (irpResult.success && irpResult.irn) {
        // Persist IRN + AckNo + AckDate + SignedQR
        const updated = await db.sale.update({
          where: { id: saleId },
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

      const sale = await db.sale.findUnique({ where: { id: saleId } })
      if (!sale || sale.tenantId !== tenantId) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })

      if (!sale.einvoiceIrn) {
        return NextResponse.json({ error: 'No IRN exists for this sale' }, { status: 400 })
      }

      // Check 24-hour window
      if (sale.einvoiceAckDate) {
        const ackDate = new Date(sale.einvoiceAckDate)
        const hoursDiff = (Date.now() - ackDate.getTime()) / (1000 * 60 * 60)
        if (hoursDiff > 24) {
          return NextResponse.json({
            error: `24-hour cancellation window expired (${hoursDiff.toFixed(1)}h). Issue a Credit Note instead.`,
          }, { status: 400 })
        }
      }

      const cancelResult = await cancelIrn(sale.einvoiceIrn, reason || '1')

      if (cancelResult.success) {
        const updated = await db.sale.update({
          where: { id: saleId },
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

      return NextResponse.json({
        configured: isIrpConfigured(),
        mode: isIrpConfigured() ? 'LIVE' : 'MANUAL',
        env: process.env.IRP_ENV || 'sandbox',
        baseUrl: getIrpBaseUrl(),
        gspCode: process.env.IRP_GSP_CODE || null,
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: unknown) {
    console.error('E-Invoice error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
