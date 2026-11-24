import { NextRequest, NextResponse } from 'next/server'
import { requireAuthAndTenant, requireTenantRole, writeAuditLog } from '@/lib/api-helpers'
import { db } from '@/lib/db-soft-delete'
import {
  validateGSTIN,
  getStateCode,
  isInterStateSupply,
  calculateItemGST,
  getFinancialYear,
  formatDateForEinvoice,
  roundTo2,
} from '@/lib/gst-utils'
import {
  generateEwbByIrn,
  generateEwbDirect,
  cancelEwb,
  extendEwb,
  isValidEwbNo,
  calculateEwbValidityDays,
  TRANSPORT_MODE,
  TransporterDetails,
} from '@/lib/ewb-integration'
import { getEffectiveGspConfig } from '@/lib/gsp-credentials'

// ============================================================
// GST E-Way Bill API
// Generates, cancels, extends, and records e-way bills.
// Supports both LIVE (GSP) and MANUAL (portal submission) modes.
// ============================================================

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body
    const requestedTenantId = typeof body?.tenantId === 'string' ? body.tenantId : ''
    if (!requestedTenantId) {
      return NextResponse.json({ error: 'No business selected' }, { status: 400 })
    }

    const requestAccess = await requireAuthAndTenant(req, requestedTenantId)
    if (requestAccess instanceof NextResponse) return requestAccess
    const tenantId = requestAccess.tenantId

    const writeActions = ['generate-payload', 'update-status', 'cancel', 'extend']
    if (writeActions.includes(action)) {
      const roleAccess = await requireTenantRole(requestAccess.userId, tenantId, ['DATA_ENTRY', 'JUNIOR_ADMIN', 'MAIN_ADMIN'])
      if (roleAccess instanceof NextResponse) return roleAccess
    }

    // ============================================================
    // Action: ewb-status — check if GSP is configured
    // ============================================================
    if (action === 'ewb-status') {
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      const tenant = await db.tenant.findUnique({
        where: { id: tenantId },
        select: { einvoiceAutoGenerate: true, ewbAutoGenerate: true },
      })
      const gspConfig = await getEffectiveGspConfig(tenantId)
      return NextResponse.json({
        configured: !!gspConfig,
        mode: gspConfig ? 'LIVE' : 'MANUAL',
        env: gspConfig?.irpEnv || 'sandbox',
        baseUrl: gspConfig ? (gspConfig.irpEnv === 'production' ? 'https://einvoice.gst.gov.in' : 'https://einvoice1.traces.gov.in') : null,
        einvoiceAutoGenerate: tenant?.einvoiceAutoGenerate || false,
        ewbAutoGenerate: tenant?.ewbAutoGenerate || false,
      })
    }

    // ============================================================
    // Action: generate-payload — build EWB JSON for manual submission
    // ============================================================
    if (action === 'generate-payload') {
      const { saleId } = body
      if (!saleId) {
        return NextResponse.json({ error: 'Sale ID required' }, { status: 400 })
      }

      const sale = await db.sale.findUnique({ where: { id: saleId } })
      if (!sale || sale.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
      }

      const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
      if (!tenant?.gstNumber) {
        return NextResponse.json({ error: 'Company GSTIN not configured. Update Settings first.' }, { status: 400 })
      }

      // Validate transporter details
      const transporter: TransporterDetails = {
        transporterId: body.transporterId,
        transporterName: body.transporterName,
        vehicleNo: body.vehicleNo,
        modeOfTransport: body.modeOfTransport || TRANSPORT_MODE.ROAD,
        distanceKm: Number(body.distanceKm) || 0,
        fromPlace: body.fromPlace,
        fromState: body.fromState,
        transDocNo: body.transDocNo,
        transDocDate: body.transDocDate,
      }

      if (!transporter.vehicleNo && !transporter.transporterId) {
        return NextResponse.json({
          error: 'Either a vehicle number (Part B) or a transporter GSTIN is required to generate an EWB.',
        }, { status: 400 })
      }

      if (transporter.transporterId && !validateGSTIN(String(transporter.transporterId)).valid) {
        return NextResponse.json({ error: 'Transporter GSTIN is invalid. Enter a valid 15-character GSTIN or leave it blank.' }, { status: 400 })
      }

      const transportDistanceKm = Number(transporter.distanceKm ?? 0)
      if (!Number.isInteger(transportDistanceKm) || transportDistanceKm <= 0) {
        return NextResponse.json({ error: 'Enter a positive whole-number transport distance in kilometres.' }, { status: 400 })
      }
      transporter.distanceKm = transportDistanceKm

      if (!Object.values(TRANSPORT_MODE).includes(transporter.modeOfTransport as any)) {
        return NextResponse.json({ error: 'Select a supported mode of transport.' }, { status: 400 })
      }

      if (transporter.vehicleNo && !/^[A-Z]{2}\d{1,2}[A-Z]{1,2}\d{3,4}$/.test(transporter.vehicleNo.replace(/\s+/g, '').toUpperCase())) {
        return NextResponse.json({
          error: 'Vehicle number must follow Indian format, e.g. WB12AB1234.',
        }, { status: 400 })
      }

      // EWB threshold check: mandatory only for consignments >= Rs.50,000
      if (sale.totalAmount < 50000) {
        return NextResponse.json({
          error: `E-Way Bill is mandatory only for consignments of Rs.50,000 or more. This invoice total is Rs.${sale.totalAmount.toFixed(2)}. You may still generate one voluntarily.`,
          code: 'BELOW_THRESHOLD',
          threshold: 50000,
        }, { status: 400 })
      }

      // If the sale has an IRN, generate Part-B-only payload (by IRN)
      if (sale.einvoiceIrn && sale.einvoiceStatus === 'GENERATED') {
        const result = await generateEwbByIrn(sale.einvoiceIrn, transporter, await getEffectiveGspConfig(tenantId))
        if (result.mode === 'MANUAL') {
          await db.sale.update({
            where: { id: saleId },
            data: {
              transporterId: transporter.transporterId || null,
              transporterName: transporter.transporterName || null,
              vehicleNo: transporter.vehicleNo || null,
              modeOfTransport: transporter.modeOfTransport || null,
              distanceKm: transporter.distanceKm || null,
            },
          })
          return NextResponse.json({
            mode: 'MANUAL',
            payload: result.ewbPayload,
            instructions: 'Submit this payload through the E-Way Bill service selected by the business, then record the returned EWB number.',
            irn: sale.einvoiceIrn,
            metadata: {
              saleId: sale.id,
              invoiceNumber: sale.invoiceNumber,
              finYear: getFinancialYear(new Date(sale.date)),
            },
          })
        }
        if (result.success) {
          // Persist EWB number on the sale
          const updated = await db.sale.update({
            where: { id: saleId },
            data: {
              ewayBillNo: result.ewbNo,
              ewayBillDate: result.ewbDate,
              ewayBillValidUpto: result.ewbValidUpto,
              ewayBillStatus: 'GENERATED',
              transporterId: transporter.transporterId,
              transporterName: transporter.transporterName,
              vehicleNo: transporter.vehicleNo,
              modeOfTransport: transporter.modeOfTransport,
              distanceKm: transporter.distanceKm,
            },
          })
          await writeAuditLog({
            tenantId,
            userId: requestAccess.userId,
            userName: requestAccess.user?.name || 'Unknown',
            action: 'CREATE',
            entityType: 'E-Way Bill',
            entityName: `EWB ${result.ewbNo} for ${sale.invoiceNumber}`,
            changes: { saleId, ewbNo: result.ewbNo, mode: 'LIVE', path: 'by-irn' },
          })
          return NextResponse.json({
            success: true,
            mode: 'LIVE',
            ewbNo: result.ewbNo,
            ewbDate: result.ewbDate,
            ewbValidUpto: result.ewbValidUpto,
            sale: updated,
          })
        }
        return NextResponse.json({
          success: false,
          mode: 'LIVE',
          error: result.errorMessage,
        }, { status: 400 })
      }

      // No IRN — generate direct EWB (Part A + Part B)
      const supplierState = getStateCode(tenant.gstNumber)
      const buyerState = sale.partyGst ? getStateCode(sale.partyGst) : supplierState
      const isInterState = sale.partyGst ? isInterStateSupply(tenant.gstNumber, sale.partyGst) : false

      let items: Record<string, any>[]
      try {
        items = JSON.parse(sale.items || '[]')
      } catch {
        return NextResponse.json({ error: 'Failed to parse invoice items.' }, { status: 400 })
      }

      if (!Array.isArray(items) || items.length === 0) {
        return NextResponse.json({ error: 'Invoice has no items.' }, { status: 400 })
      }

      const itemDetails = items.map((item, idx) => {
        const qty = Number(item.qty) || 0
        const rate = Number(item.rate) || 0
        const discount = Number(item.discount || 0)
        const gstRt = getItemGstRate(item)
        const itemGST = calculateItemGST(qty, rate, gstRt, discount, isInterState)
        return {
          hsnCode: String(item.hsn || ''),
          name: String(item.name || `Item ${idx + 1}`),
          quantity: qty,
          unit: String(item.unit || 'PCS'),
          taxableValue: itemGST.assAmt,
          gstRate: gstRt,
        }
      })

      const saleData = {
        invoiceNumber: sale.invoiceNumber,
        invoiceDate: formatDateForEinvoice(sale.date),
        partyName: sale.partyName,
        partyGst: sale.partyGst || undefined,
        partyAddress: sale.partyAddress || undefined,
        partyStateCode: buyerState,
        totalAmount: sale.totalAmount,
        cgstAmount: isInterState ? 0 : sale.gstAmount / 2,
        sgstAmount: isInterState ? 0 : sale.gstAmount / 2,
        igstAmount: isInterState ? sale.gstAmount : 0,
        supplierGstin: tenant.gstNumber,
        supplierName: tenant.name,
        supplierAddress: tenant.address || undefined,
        supplierStateCode: supplierState,
        items: itemDetails,
      }

      const result = await generateEwbDirect(saleData, transporter, await getEffectiveGspConfig(tenantId))

      if (result.mode === 'MANUAL') {
        await db.sale.update({
          where: { id: saleId },
          data: {
            transporterId: transporter.transporterId || null,
            transporterName: transporter.transporterName || null,
            vehicleNo: transporter.vehicleNo || null,
            modeOfTransport: transporter.modeOfTransport || null,
            distanceKm: transporter.distanceKm || null,
          },
        })
        return NextResponse.json({
          mode: 'MANUAL',
          payload: result.ewbPayload,
          instructions: 'Submit this payload through the E-Way Bill service selected by the business, then record the returned EWB number.',
          metadata: {
            saleId: sale.id,
            invoiceNumber: sale.invoiceNumber,
            finYear: getFinancialYear(new Date(sale.date)),
          },
        })
      }

      if (result.success) {
        const updated = await db.sale.update({
          where: { id: saleId },
          data: {
            ewayBillNo: result.ewbNo,
            ewayBillDate: result.ewbDate,
            ewayBillValidUpto: result.ewbValidUpto,
            ewayBillStatus: 'GENERATED',
            transporterId: transporter.transporterId,
            transporterName: transporter.transporterName,
            vehicleNo: transporter.vehicleNo,
            modeOfTransport: transporter.modeOfTransport,
            distanceKm: transporter.distanceKm,
          },
        })
        await writeAuditLog({
          tenantId,
          userId: requestAccess.userId,
          userName: requestAccess.user?.name || 'Unknown',
          action: 'CREATE',
          entityType: 'E-Way Bill',
          entityName: `EWB ${result.ewbNo} for ${sale.invoiceNumber}`,
          changes: { saleId, ewbNo: result.ewbNo, mode: 'LIVE', path: 'direct' },
        })
        return NextResponse.json({
          success: true,
          mode: 'LIVE',
          ewbNo: result.ewbNo,
          ewbDate: result.ewbDate,
          ewbValidUpto: result.ewbValidUpto,
          sale: updated,
        })
      }

      return NextResponse.json({
        success: false,
        mode: 'LIVE',
        error: result.errorMessage,
      }, { status: 400 })
    }

    // ============================================================
    // Action: update-status — manually record an EWB number
    // (after manual submission through the business-selected E-Way Bill service)
    // ============================================================
    if (action === 'update-status') {
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      const { saleId, ewbNo, ewbDate, ewbValidUpto, transporterId, transporterName, vehicleNo, modeOfTransport, distanceKm } = body
      if (!saleId) {
        return NextResponse.json({ error: 'Sale ID required' }, { status: 400 })
      }

      const sale = await db.sale.findUnique({ where: { id: saleId } })
      if (!sale || sale.tenantId !== access.tenantId) {
        return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
      }

      if (typeof ewbNo !== 'string' || !isValidEwbNo(ewbNo)) {
        return NextResponse.json({
          error: 'Enter the 12-digit numeric EWB number returned by the E-Way Bill service.',
        }, { status: 400 })
      }

      if (typeof ewbDate !== 'string' || !ewbDate || Number.isNaN(new Date(ewbDate).getTime())) {
        return NextResponse.json({
          error: 'Valid EWB generation date is required (YYYY-MM-DD).',
        }, { status: 400 })
      }

      if (ewbValidUpto && (typeof ewbValidUpto !== 'string' || Number.isNaN(new Date(ewbValidUpto).getTime()) || new Date(ewbValidUpto).getTime() <= new Date(ewbDate).getTime())) {
        return NextResponse.json({ error: 'EWB validity date must be a valid date/time later than the generation date/time.' }, { status: 400 })
      }

      // Retain the legacy distance-based estimate only when an older client
      // does not submit the exact validity timestamp returned by the portal.
      let validUpto = ewbValidUpto
      if (!validUpto && distanceKm) {
        const days = calculateEwbValidityDays(Number(distanceKm))
        const validDate = new Date(ewbDate)
        validDate.setDate(validDate.getDate() + days)
        validUpto = validDate.toISOString()
      }

      const updated = await db.sale.update({
        where: { id: saleId },
        data: {
          ewayBillNo: ewbNo.trim(),
          ewayBillDate: ewbDate,
          ewayBillValidUpto: validUpto || null,
          ewayBillStatus: 'GENERATED',
          transporterId: transporterId || null,
          transporterName: transporterName || null,
          vehicleNo: vehicleNo || null,
          modeOfTransport: modeOfTransport || null,
          distanceKm: Number(distanceKm) || null,
        },
      })

      await writeAuditLog({
        tenantId,
        userId: access.userId,
        userName: access.user?.name || 'Unknown',
        action: 'CREATE',
        entityType: 'E-Way Bill',
        entityName: `EWB ${ewbNo} recorded for ${sale.invoiceNumber}`,
        changes: { saleId, ewbNo, mode: 'MANUAL' },
      })

      return NextResponse.json({ sale: updated })
    }

    // ============================================================
    // Action: cancel — cancel an EWB (within validity period)
    // ============================================================
    if (action === 'cancel') {
      const { saleId, cancelReason, cancelRemark } = body
      if (!saleId) {
        return NextResponse.json({ error: 'Sale ID required' }, { status: 400 })
      }

      const reasonCode = String(cancelReason || '1')
      if (!/^[1-5]$/.test(reasonCode)) {
        return NextResponse.json({
          error: 'Invalid EWB cancellation reason. Use a code from 1 to 5.',
        }, { status: 400 })
      }

      const sale = await db.sale.findUnique({ where: { id: saleId } })
      if (!sale || sale.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
      }

      if (!sale.ewayBillNo || sale.ewayBillStatus !== 'GENERATED') {
        return NextResponse.json({
          error: 'Only an active EWB can be cancelled.',
        }, { status: 400 })
      }

      if (!sale.ewayBillValidUpto) {
        return NextResponse.json({
          error: 'EWB validity date is missing. Verify the EWB record before cancellation.',
        }, { status: 400 })
      }

      // Check validity window
      const now = Date.now()
      const validUpto = new Date(sale.ewayBillValidUpto).getTime()
      if (!Number.isFinite(validUpto) || now > validUpto) {
        return NextResponse.json({
          error: 'The EWB validity has expired. Expired EWBs cannot be cancelled; generate a new one if needed.',
        }, { status: 400 })
      }

      const result = await cancelEwb(sale.ewayBillNo, reasonCode, String(cancelRemark || 'Cancelled via BizBook Pro'), await getEffectiveGspConfig(tenantId))

      if (!result.success) {
        return NextResponse.json({
          success: false,
          mode: result.mode,
          error: result.errorMessage || 'EWB cancellation failed',
        }, { status: 502 })
      }

      const updated = await db.sale.update({
        where: { id: saleId },
        data: {
          ewayBillStatus: 'CANCELLED',
          ewayBillCanceledAt: new Date(),
          ewayBillCancelReason: reasonCode,
        },
      })

      await writeAuditLog({
        tenantId,
        userId: requestAccess.userId,
        userName: requestAccess.user?.name || 'Unknown',
        action: 'DELETE',
        entityType: 'E-Way Bill',
        entityName: `EWB ${sale.ewayBillNo} cancelled for ${sale.invoiceNumber}`,
        changes: { saleId, ewbNo: sale.ewayBillNo, reason: reasonCode },
      })

      return NextResponse.json({ success: true, sale: updated })
    }

    // ============================================================
    // Action: extend — extend EWB validity (before expiry)
    // ============================================================
    if (action === 'extend') {
      const { saleId, vehicleNo, modeOfTransport, distanceKm, fromPlace, fromState } = body
      if (!saleId) {
        return NextResponse.json({ error: 'Sale ID required' }, { status: 400 })
      }

      const sale = await db.sale.findUnique({ where: { id: saleId } })
      if (!sale || sale.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
      }

      if (!sale.ewayBillNo || sale.ewayBillStatus !== 'GENERATED') {
        return NextResponse.json({
          error: 'Only an active EWB can be extended.',
        }, { status: 400 })
      }

      if (!sale.ewayBillValidUpto) {
        return NextResponse.json({
          error: 'EWB validity date is missing.',
        }, { status: 400 })
      }

      // Extension must be requested BEFORE expiry
      const now = Date.now()
      const validUpto = new Date(sale.ewayBillValidUpto).getTime()
      if (!Number.isFinite(validUpto) || now > validUpto) {
        return NextResponse.json({
          error: 'The EWB validity has expired. Expired EWBs cannot be extended; generate a new one instead.',
        }, { status: 400 })
      }

      if (!vehicleNo) {
        return NextResponse.json({
          error: 'New vehicle number is required to extend the EWB.',
        }, { status: 400 })
      }

      const transporter: TransporterDetails = {
        vehicleNo: String(vehicleNo).replace(/\s+/g, '').toUpperCase(),
        modeOfTransport: modeOfTransport || TRANSPORT_MODE.ROAD,
        distanceKm: Number(distanceKm) || 0,
        fromPlace,
        fromState,
      }

      const result = await extendEwb(sale.ewayBillNo, transporter, await getEffectiveGspConfig(tenantId))

      if (!result.success) {
        return NextResponse.json({
          success: false,
          mode: result.mode,
          error: result.errorMessage || 'EWB extension failed',
        }, { status: 502 })
      }

      const updated = await db.sale.update({
        where: { id: saleId },
        data: {
          ewayBillValidUpto: result.ewbValidUpto || sale.ewayBillValidUpto,
          ewayBillStatus: 'EXTENDED',
          vehicleNo: transporter.vehicleNo,
          modeOfTransport: transporter.modeOfTransport,
        },
      })

      await writeAuditLog({
        tenantId,
        userId: requestAccess.userId,
        userName: requestAccess.user?.name || 'Unknown',
        action: 'UPDATE',
        entityType: 'E-Way Bill',
        entityName: `EWB ${sale.ewayBillNo} extended for ${sale.invoiceNumber}`,
        changes: { saleId, ewbNo: sale.ewayBillNo, newValidUpto: result.ewbValidUpto },
      })

      return NextResponse.json({ success: true, sale: updated })
    }

    // ============================================================
    // Action: status — get EWB status for a sale
    // ============================================================
    if (action === 'status') {
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access

      const { saleId } = body
      if (!saleId) {
        return NextResponse.json({ error: 'Sale ID required' }, { status: 400 })
      }

      const sale = await db.sale.findUnique({
        where: { id: saleId },
        select: {
          tenantId: true,
          ewayBillNo: true,
          ewayBillDate: true,
          ewayBillValidUpto: true,
          ewayBillStatus: true,
          ewayBillCanceledAt: true,
          ewayBillCancelReason: true,
          transporterId: true,
          transporterName: true,
          vehicleNo: true,
          modeOfTransport: true,
          distanceKm: true,
          invoiceNumber: true,
          einvoiceIrn: true,
          einvoiceStatus: true,
        },
      })

      if (!sale || sale.tenantId !== tenantId) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }

      return NextResponse.json({ ewaybill: sale })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: unknown) {
    console.error('E-Way Bill API error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
