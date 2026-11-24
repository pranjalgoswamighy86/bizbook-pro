/**
 * v6.31.0: E-Way Bill (EWB) Integration Library
 * ============================================================
 * Direct integration with the NIC E-Way Bill system for generating,
 * cancelling, and extending e-way bills.
 *
 * Two generation paths:
 *   A. generateEwbByIrn(irn, transporterDetails) — extends an existing
 *      IRP-generated IRN with Part B (vehicle/transporter). The IRP
 *      auto-populates Part A from the invoice data.
 *   B. generateEwbDirect(saleData, transporterDetails) — generates EWB
 *      without an IRN (for B2C or below-threshold invoices where e-invoice
 *      is not mandatory). Both Part A and Part B are filled from sale data.
 *
 * Environment variables (shared with IRP integration):
 *   - IRP_GSP_CODE: GSP identifier (e.g. 'clear', 'adaequare', 'mastersindia')
 *   - IRP_GSP_USERNAME, IRP_GSP_PASSWORD
 *   - IRP_GSP_CLIENT_ID, IRP_GSP_CLIENT_SECRET
 *   - IRP_ENV: 'sandbox' or 'production'
 *
 * If GSP credentials are not configured, all functions return MANUAL mode —
 * the caller generates the EWB JSON payload, submits it manually on
 * the selected E-Way Bill portal, then pastes back the 12-digit EWB number.
 *
 * References:
 *   - EWB portal: https://the selected E-Way Bill portal
 *   - EWB API: https://ewayapi.nic.in/api/v1/ewaybill/
 *   - Validity: 1 day per 200 km (min 1 day, max 30 days)
 *   - Cancellation: within validity period (not extendable after expiry)
 *   - Extension: can extend before expiry with new vehicle + distance
 *   - EWB number format: 12-digit numeric
 */

import crypto from 'crypto'
import { getIrpBaseUrl, isIrpConfigured } from './irp-integration'
import type { TenantGspConfig } from './gsp-credentials'

// EWB API endpoints (on the same GSP/IRP base URL as e-invoice)
const EWB_GENERATE_BY_IRN = '/einvoice/api/v1/ewaybill/irn'
const EWB_GENERATE_DIRECT = '/einvoice/api/v1/ewaybill'
const EWB_CANCEL = '/einvoice/api/v1/ewayapi/ewaybill/cancel'
const EWB_EXTEND = '/einvoice/api/v1/ewayapi/ewaybill/extendvalidity'
const EWB_UPDATE_VEHICLE = '/einvoice/api/v1/ewayapi/ewaybill/updatevehicle'

// Mode of transport codes per NIC spec
export const TRANSPORT_MODE = {
  ROAD: '2',
  RAIL: 'R',
  AIR: '1',
  SHIP: 'S',
  IN_TRANSIT: 'I',
} as const

// Supply type codes
export const SUPPLY_TYPE = {
  OUTWARD: 'O',   // Outward supply (sale)
  INWARD: 'I',    // Inward supply (purchase return)
} as const

// Sub-supply type codes (for direct generation without IRN)
export const SUB_SUPPLY_TYPE = {
  SUPPLY: '1',
  IMPORT: '2',
  EXPORT: '3',
  JOB_WORK: '4',
  FOROWN_USE: '5',
  JOB_WORK_RETURNS: '6',
  SALES_RETURN: '7',
  OTHERS: '8',
} as const

// Transaction type codes
export const TRANSACTION_TYPE = {
  REGULAR: '1',           // BillTo → ShipTo (same party)
  BILL_TO_DISPATCH: '2',  // BillTo and DispatchTo are different
  DISPATCH_TO_BILL: '3',  // DispatchTo and BillTo are different
  COMBINED: '4',          // BillTo = DispatchTo = third party
} as const

export interface TransporterDetails {
  transporterId?: string      // 15-char GSTIN of transporter
  transporterName?: string
  vehicleNo?: string          // 10-char, e.g. "WB12AB1234"
  modeOfTransport?: string    // TRANSPORT_MODE value
  distanceKm?: number         // Distance between supplier and recipient
  // For multi-leg transport:
  fromPlace?: string
  fromState?: string          // State code (01-38)
  transDocNo?: string         // Transport document number (challan/bilty)
  transDocDate?: string       // YYYY-MM-DD
}

export interface EwbResult {
  success: boolean
  mode: 'LIVE' | 'MANUAL'
  ewbNo?: string              // 12-digit EWB number
  ewbDate?: string            // ISO date string
  ewbValidUpto?: string       // ISO date string
  errorMessage?: string
  // For MANUAL mode: the JSON payload to submit on the selected E-Way Bill portal
  ewbPayload?: Record<string, unknown>
}

/**
 * Generate an E-Way Bill by extending an existing IRN with Part B (transporter).
 * Use this path when the sale already has an e-invoice IRN.
 *
 * The IRP auto-fills Part A (supplier, recipient, goods, value) from the IRN.
 * We only need to supply Part B (vehicle, transporter, distance).
 */
export async function generateEwbByIrn(
  irn: string,
  transporter: TransporterDetails,
  config: TenantGspConfig | null
): Promise<EwbResult> {
  if (!config || !isIrpConfigured(config)) {
    return {
      success: false,
      mode: 'MANUAL',
      errorMessage: 'GSP not configured. Submit the EWB payload manually on the selected E-Way Bill portal, then record the 12-digit EWB number.',
      ewbPayload: buildEwbByIrnPayload(irn, transporter),
    }
  }

  const payload = buildEwbByIrnPayload(irn, transporter)

  try {
    const token = await getEwbAuthToken(config)
    const baseUrl = getIrpBaseUrl(config)

    const res = await fetch(`${baseUrl}${EWB_GENERATE_BY_IRN}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'gsp-code': config.gspCode,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    })

    if (!res.ok) {
      const errText = `HTTP ${res.status}`
      return {
        success: false,
        mode: 'LIVE',
        errorMessage: `EWB API HTTP ${res.status}: ${errText.slice(0, 500)}`,
      }
    }

    const data = await res.json()

    // NIC success: Status=1, Result contains EwbNo, EwbDate, EwbValidUpto
    if (data.Status === 1 || data.Status === '1') {
      return {
        success: true,
        mode: 'LIVE',
        ewbNo: String(data.Result?.EwbNo || ''),
        ewbDate: data.Result?.EwbDate,
        ewbValidUpto: data.Result?.EwbValidUpto,
      }
    }

    const errorMessages = (data.ErrorDetails || []).map((e: any) => e.ErrorMessage).join('; ')
    return {
      success: false,
      mode: 'LIVE',
      errorMessage: errorMessages || data.Message || 'Unknown EWB error',
    }
  } catch (err: any) {
    return {
      success: false,
      mode: 'LIVE',
      errorMessage: `Network error: ${err?.message || 'Unknown'}`,
    }
  }
}

/**
 * Generate an E-Way Bill directly (without an IRN).
 * Use this path for B2C sales or below-threshold invoices.
 * Both Part A (goods/value) and Part B (transporter) must be supplied.
 */
export async function generateEwbDirect(
  saleData: {
    invoiceNumber: string
    invoiceDate: string         // YYYY-MM-DD
    partyName: string
    partyGst?: string
    partyAddress?: string
    partyStateCode?: string
    totalAmount: number
    cgstAmount?: number
    sgstAmount?: number
    igstAmount?: number
    cessAmount?: number
    supplierGstin: string
    supplierName: string
    supplierAddress?: string
    supplierStateCode: string
    items: Array<{
      hsnCode: string
      name: string
      quantity: number
      unit: string
      taxableValue: number
      gstRate: number
    }>
  },
  transporter: TransporterDetails,
  config: TenantGspConfig | null
): Promise<EwbResult> {
  if (!config || !isIrpConfigured(config)) {
    return {
      success: false,
      mode: 'MANUAL',
      errorMessage: 'GSP not configured. Submit the EWB payload manually on the selected E-Way Bill portal, then record the 12-digit EWB number.',
      ewbPayload: buildEwbDirectPayload(saleData, transporter),
    }
  }

  const payload = buildEwbDirectPayload(saleData, transporter)

  try {
    const token = await getEwbAuthToken(config)
    const baseUrl = getIrpBaseUrl(config)

    const res = await fetch(`${baseUrl}${EWB_GENERATE_DIRECT}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'gsp-code': config.gspCode,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    })

    if (!res.ok) {
      const errText = `HTTP ${res.status}`
      return {
        success: false,
        mode: 'LIVE',
        errorMessage: `EWB API HTTP ${res.status}: ${errText.slice(0, 500)}`,
      }
    }

    const data = await res.json()

    if (data.Status === 1 || data.Status === '1') {
      return {
        success: true,
        mode: 'LIVE',
        ewbNo: String(data.Result?.EwbNo || ''),
        ewbDate: data.Result?.EwbDate,
        ewbValidUpto: data.Result?.EwbValidUpto,
      }
    }

    const errorMessages = (data.ErrorDetails || []).map((e: any) => e.ErrorMessage).join('; ')
    return {
      success: false,
      mode: 'LIVE',
      errorMessage: errorMessages || data.Message || 'Unknown EWB error',
    }
  } catch (err: any) {
    return {
      success: false,
      mode: 'LIVE',
      errorMessage: `Network error: ${err?.message || 'Unknown'}`,
    }
  }
}

/**
 * Cancel an E-Way Bill.
 * Can only be cancelled within its validity period.
 */
export async function cancelEwb(
  ewbNo: string,
  cancelReason: string,   // 1-5 per NIC spec
  cancelRemark: string,
  config: TenantGspConfig | null
): Promise<EwbResult> {
  if (!config || !isIrpConfigured(config)) {
    return {
      success: false,
      mode: 'MANUAL',
      errorMessage: 'GSP not configured. Cancel the EWB manually on the selected E-Way Bill portal.',
    }
  }

  try {
    const token = await getEwbAuthToken(config)
    const baseUrl = getIrpBaseUrl(config)

    const res = await fetch(`${baseUrl}${EWB_CANCEL}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'gsp-code': config.gspCode,
      },
      body: JSON.stringify({
        ewbNo,
        cancelReason: String(cancelReason),
        cancelRemark: cancelRemark.slice(0, 100),
      }),
      signal: AbortSignal.timeout(20000),
    })

    if (!res.ok) {
      const errText = `HTTP ${res.status}`
      return {
        success: false,
        mode: 'LIVE',
        errorMessage: `EWB cancel HTTP ${res.status}: ${errText.slice(0, 500)}`,
      }
    }

    const data = await res.json()
    if (data.Status === 1 || data.Status === '1') {
      return { success: true, mode: 'LIVE' }
    }

    const errorMessages = (data.ErrorDetails || []).map((e: any) => e.ErrorMessage).join('; ')
    return {
      success: false,
      mode: 'LIVE',
      errorMessage: errorMessages || data.Message || 'EWB cancellation failed',
    }
  } catch (err: any) {
    return {
      success: false,
      mode: 'LIVE',
      errorMessage: `Network error: ${err?.message || 'Unknown'}`,
    }
  }
}

/**
 * Extend EWB validity (when transit exceeds original validity).
 * Must be done BEFORE the current validity expires.
 * Requires new vehicle number and additional distance.
 */
export async function extendEwb(
  ewbNo: string,
  transporter: TransporterDetails,
  config: TenantGspConfig | null
): Promise<EwbResult> {
  if (!config || !isIrpConfigured(config)) {
    return {
      success: false,
      mode: 'MANUAL',
      errorMessage: 'GSP not configured. Extend the EWB manually on the selected E-Way Bill portal.',
    }
  }

  try {
    const token = await getEwbAuthToken(config)
    const baseUrl = getIrpBaseUrl(config)

    const res = await fetch(`${baseUrl}${EWB_EXTEND}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'gsp-code': config.gspCode,
      },
      body: JSON.stringify({
        ewbNo,
        vehicleNo: transporter.vehicleNo,
        transMode: transporter.modeOfTransport || TRANSPORT_MODE.ROAD,
        fromPlace: transporter.fromPlace || 'Location',
        fromState: transporter.fromState,
        remainingDistance: String(transporter.distanceKm || 0),
        consignmentStatus: 'IN_TRANSIT',
      }),
      signal: AbortSignal.timeout(20000),
    })

    if (!res.ok) {
      const errText = `HTTP ${res.status}`
      return {
        success: false,
        mode: 'LIVE',
        errorMessage: `EWB extend HTTP ${res.status}: ${errText.slice(0, 500)}`,
      }
    }

    const data = await res.json()
    if (data.Status === 1 || data.Status === '1') {
      return {
        success: true,
        mode: 'LIVE',
        ewbNo: String(data.Result?.EwbNo || ewbNo),
        ewbDate: data.Result?.EwbDate,
        ewbValidUpto: data.Result?.EwbValidUpto,
      }
    }

    const errorMessages = (data.ErrorDetails || []).map((e: any) => e.ErrorMessage).join('; ')
    return {
      success: false,
      mode: 'LIVE',
      errorMessage: errorMessages || data.Message || 'EWB extension failed',
    }
  } catch (err: any) {
    return {
      success: false,
      mode: 'LIVE',
      errorMessage: `Network error: ${err?.message || 'Unknown'}`,
    }
  }
}

// ============================================================
// Internal: Payload builders
// ============================================================

function buildEwbByIrnPayload(irn: string, t: TransporterDetails): Record<string, unknown> {
  return {
    Irn: irn,
    Distance: String(t.distanceKm || 0),
    TransMode: t.modeOfTransport || TRANSPORT_MODE.ROAD,
    VehicleNo: (t.vehicleNo || '').replace(/\s+/g, '').toUpperCase(),
    TransDocNo: t.transDocNo || '',
    TransDocDate: t.transDocDate || '',
    // If transporter is registered (has GSTIN), assign to them
    // (they will generate the EWB themselves from their dashboard)
    TransId: t.transporterId || '',
  }
}

function buildEwbDirectPayload(
  sale: {
    invoiceNumber: string
    invoiceDate: string
    partyName: string
    partyGst?: string
    partyAddress?: string
    partyStateCode?: string
    totalAmount: number
    cgstAmount?: number
    sgstAmount?: number
    igstAmount?: number
    cessAmount?: number
    supplierGstin: string
    supplierName: string
    supplierAddress?: string
    supplierStateCode: string
    items: Array<{
      hsnCode: string
      name: string
      quantity: number
      unit: string
      taxableValue: number
      gstRate: number
    }>
  },
  t: TransporterDetails
): Record<string, unknown> {
  const itemList = sale.items.map((item, idx) => ({
    itemNo: String(idx + 1),
    hsnCode: item.hsnCode,
    productName: item.name.slice(0, 50),
    productDesc: '',
    qty: String(item.quantity),
    qtyUnit: item.unit || 'PCS',
    taxableAmount: String(item.taxableValue.toFixed(2)),
    sgstRate: String(((sale.sgstAmount || 0) > 0 ? item.gstRate / 2 : 0).toFixed(2)),
    cgstRate: String(((sale.cgstAmount || 0) > 0 ? item.gstRate / 2 : 0).toFixed(2)),
    igstRate: String(((sale.igstAmount || 0) > 0 ? item.gstRate : 0).toFixed(2)),
  }))

  return {
    supplyType: SUPPLY_TYPE.OUTWARD,
    subSupplyType: SUB_SUPPLY_TYPE.SUPPLY,
    subSupplyDesc: '',
    docType: 'INV',   // Tax Invoice
    docNo: sale.invoiceNumber,
    docDate: sale.invoiceDate,
    transactionType: TRANSACTION_TYPE.REGULAR,
    // From (supplier / dispatcher)
    fromGstin: sale.supplierGstin,
    fromLegalName: sale.supplierName,
    fromTrdName: sale.supplierName,
    fromAddr1: sale.supplierAddress || '',
    fromPlace: '',
    fromStateCode: sale.supplierStateCode,
    // To (recipient / consignee)
    toGstin: sale.partyGst || 'URP',  // URP = Unregistered Person
    toLegalName: sale.partyName,
    toTrdName: sale.partyName,
    toAddr1: sale.partyAddress || '',
    toPlace: '',
    toStateCode: sale.partyStateCode || sale.supplierStateCode,
    // Item details
    itemList,
    // Total values
    totalValue: String(sale.totalAmount.toFixed(2)),
    cgstValue: String((sale.cgstAmount || 0).toFixed(2)),
    sgstValue: String((sale.sgstAmount || 0).toFixed(2)),
    igstValue: String((sale.igstAmount || 0).toFixed(2)),
    cessValue: String((sale.cessAmount || 0).toFixed(2)),
    nonTaxableValue: '0',
    // Transporter (Part B)
    transMode: t.modeOfTransport || TRANSPORT_MODE.ROAD,
    vehicleNo: (t.vehicleNo || '').replace(/\s+/g, '').toUpperCase(),
    transDistance: String(t.distanceKm || 0),
    transporterName: t.transporterName || '',
    transporterId: t.transporterId || '',
    transDocNo: t.transDocNo || '',
    transDocDate: t.transDocDate || '',
  }
}

// Tenant-scoped EWB token cache. Credentials are never shared between tenants.
const ewbTokenCache = new Map<string, { token: string; expiresAt: number; fingerprint: string }>()

async function getEwbAuthToken(config: TenantGspConfig): Promise<string> {
  const fingerprint = crypto.createHash('sha256').update([
    config.gspCode, config.gspClientId, config.gspClientSecret,
    config.gspUsername, config.gspPassword, config.irpEnv,
  ].join('\\0')).digest('hex')
  const cached = ewbTokenCache.get(config.tenantId)
  if (cached && cached.fingerprint === fingerprint && Date.now() < cached.expiresAt - 5 * 60 * 1000) return cached.token

  const baseUrl = getIrpBaseUrl(config)
  const authRes = await fetch(`${baseUrl}/ein-v1/registration/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'gsp-code': config.gspCode },
    body: JSON.stringify({
      Username: config.gspUsername, Password: config.gspPassword,
      ClientId: config.gspClientId, ClientSecret: config.gspClientSecret, GrantType: 'password',
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!authRes.ok) throw new Error(`GSP authentication failed (HTTP ${authRes.status}).`)
  const authData = await authRes.json()
  if (!authData.access_token || !Number.isFinite(authData.expires_in) || authData.expires_in <= 0) {
    throw new Error('GSP authentication returned an invalid token response.')
  }
  ewbTokenCache.set(config.tenantId, {
    token: authData.access_token, expiresAt: Date.now() + authData.expires_in * 1000, fingerprint,
  })
  return authData.access_token
}

/**
 * Validate a 12-digit EWB number.
 */
export function isValidEwbNo(ewbNo: string): boolean {
  return /^\d{12}$/.test(ewbNo.trim())
}

/**
 * Calculate EWB validity (days) based on distance.
 * 1 day per 200 km, minimum 1 day, maximum 30 days (per NIC rules).
 */
export function calculateEwbValidityDays(distanceKm: number): number {
  if (distanceKm <= 0) return 1
  const days = Math.ceil(distanceKm / 200)
  return Math.min(Math.max(days, 1), 30)
}
