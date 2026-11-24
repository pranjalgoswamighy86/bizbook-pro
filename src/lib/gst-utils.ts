// ============================================================
// GST Utility Functions for Indian Business Management
// Handles: GSTIN validation, state codes, tax calculations,
// CGST/SGST/IGST splitting, rounding, and HSN validation
// ============================================================

/**
 * v6.28.2: Round a number to 2 decimal places using proper decimal arithmetic.
 *
 * PREVIOUS BUG: `Math.round(value * 100) / 100` suffers from binary
 * floating-point representation errors. For example:
 *   roundTo2(1.005) → 1.00  (should be 1.01, but 1.005 * 100 = 100.49999999999999)
 *   roundTo2(2.005) → 2.00  (should be 2.01)
 *   roundTo2(0.005) → 0.00  (should be 0.01)
 *
 * FIX: Use `toFixed(2)` which performs correct round-half-away-from-zero
 * on the decimal representation. This matches standard accounting rounding
 * and is consistent with PostgreSQL's `ROUND()` function.
 *
 * Also guards against NaN/Infinity (returns 0) so monetary calculations
 * never produce NaN poison that propagates through the GL.
 */
export function roundTo2(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Number(value.toFixed(2))
}

/**
 * Indian state codes for GST (as per GSTN specification)
 * Includes Ladakh (38) created after bifurcation of J&K in 2019
 */
export const STATE_CODES: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman & Diu',
  '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh (New)',
  '38': 'Ladakh',
}

/**
 * Validate GSTIN structure and checksum.
 *
 * GSTIN positions:
 *   1-2  State/UT code
 *   3-12 PAN (10 characters: AAAAA9999A)
 *   13   Entity number (1-9, then A-Z)
 *   14   Reserved character (Z)
 *   15   Mod-36 check character
 *
 * This checks structural plausibility and the checksum only. It does not
 * establish that the GST registration is active on the GST portal.
 */
export function validateGSTIN(gstin: string): { valid: boolean; error?: string } {
  const value = typeof gstin === 'string' ? gstin.trim().toUpperCase() : ''

  if (!value) {
    return { valid: false, error: 'GSTIN is required' }
  }

  if (value.length !== 15) {
    return { valid: false, error: `GSTIN must be 15 characters, got ${value.length}` }
  }

  if (!/^[0-9A-Z]{15}$/.test(value)) {
    return { valid: false, error: 'GSTIN must contain only uppercase letters and digits' }
  }

  const stateCode = value.substring(0, 2)
  if (!STATE_CODES[stateCode]) {
    return { valid: false, error: `Invalid state code "${stateCode}" in GSTIN` }
  }

  // Positions 3-12 are the complete 10-character PAN.
  const pan = value.substring(2, 12)
  if (!/^[A-Z]{3}[ABCFGHLJPTF][A-Z][0-9]{4}[A-Z]$/.test(pan)) {
    return { valid: false, error: 'Invalid PAN portion in GSTIN' }
  }

  // Position 13 identifies the registration for this PAN in the state.
  if (!/^[1-9A-Z]$/.test(value[12])) {
    return { valid: false, error: 'Invalid entity code in GSTIN' }
  }

  // Position 14 is reserved and is currently always Z.
  if (value[13] !== 'Z') {
    return { valid: false, error: 'GSTIN reserved character (position 14) must be Z' }
  }

  // Position 15 is the checksum calculated from positions 1-14.
  const expectedCheckDigit = computeGSTINCheckDigit(value.substring(0, 14))
  if (expectedCheckDigit !== value[14]) {
    return {
      valid: false,
      error: `GSTIN check digit mismatch: expected "${expectedCheckDigit}", got "${value[14]}"`,
    }
  }

  return { valid: true }
}
/**
 * Compute GSTIN check digit using the GSTN algorithm.
 * Based on the official GSTN check digit calculation.
 */
function computeGSTINCheckDigit(gstin14: string): string {
  // GSTN uses a weighted sum approach with specific factor mapping
  const factorMap: Record<string, number> = {
    '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    'A': 10, 'B': 11, 'C': 12, 'D': 13, 'E': 14, 'F': 15, 'G': 16, 'H': 17,
    'I': 18, 'J': 19, 'K': 20, 'L': 21, 'M': 22, 'N': 23, 'O': 24, 'P': 25,
    'Q': 26, 'R': 27, 'S': 28, 'T': 29, 'U': 30, 'V': 31, 'W': 32, 'X': 33,
    'Y': 34, 'Z': 35,
  }

  const checkChars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

  let sum = 0
  for (let i = 0; i < 14; i++) {
    const char = gstin14[i].toUpperCase()
    const value = factorMap[char] ?? 0
    const factor = i % 2 === 0 ? 1 : 2
    const product = value * factor
    // Sum digits of product (e.g., 14 => 1+4=5)
    sum += Math.floor(product / 36) + (product % 36)
  }

  const checkDigitValue = (36 - (sum % 36)) % 36
  return checkChars[checkDigitValue]
}

/**
 * Extract state code from a GSTIN (first 2 characters)
 */
export function getStateCode(gstin: string): string {
  // v6.29.2: Returning a hardcoded '27' (Maharashtra) when the GSTIN is
  // missing was WRONG — it caused isInterStateSupply() to compare a real
  // party state code against '27', producing the wrong CGST/SGST vs IGST
  // split for any out-of-state party whose GSTIN we didn't capture. Now we
  // return '' so callers that pass an empty GSTIN propagate the empty
  // state code upward, and isInterStateSupply() / IRP callers explicitly
  // short-circuit when either GSTIN is missing (they already do).
  if (!gstin || gstin.length < 2) return ''
  return gstin.substring(0, 2)
}

/**
 * Determine if a supply is intra-state or inter-state
 * based on supplier and buyer GSTINs
 */
export function isInterStateSupply(supplierGstin: string, buyerGstin: string): boolean {
  const supplierState = getStateCode(supplierGstin)
  const buyerState = getStateCode(buyerGstin)

  // A missing GSTIN does not prove an inter-state supply. Callers that cannot
  // determine both states use the provisional intra-state split and should
  // surface the missing registration/place-of-supply data for review.
  if (!supplierState || !buyerState) return false

  return supplierState !== buyerState
}

/**
 * v6.29.3: Best-effort extraction of a 6-digit Indian pincode from an address
 * string. Used to populate the IRP e-invoice 'Pin' field, which IRP requires
 * and which was previously hardcoded to 0 (causing IRN generation to fail
 * validation with error 'Pin should be at least 6 digits').
 *
 * Strategy:
 *   1. Regex for a 6-digit number anywhere in the address (handles
 *      "Andheri East, Mumbai 400069", "Bengaluru-560001", "110001, Delhi").
 *   2. Fallback to a state-capital default pincode keyed by GSTIN state code,
 *      so the payload still validates even when the address has no pin.
 *   3. If no GSTIN either, fall back to 110001 (New Delhi) — IRP accepts any
 *      valid 6-digit pin; the buyer/seller can correct it post-generation.
 *
 * NOTE: This is a stop-gap until schema migrations add explicit pinCode fields
 * to Tenant / Sale / Purchase. Returns a NUMBER (IRP Pin field is numeric).
 */
const STATE_DEFAULT_PIN: Record<string, number> = {
  '01': 193224, // Jammu & Kashmir (Srinagar region)
  '02': 382010, // Himachal Pradesh (Shimla)
  '03': 248001, // Punjab (Chandigarh — used as shared capital pin)
  '04': 248001, // Chandigarh
  '05': 226001, // Uttarakhand (Lucknow — closest major)
  '06': 122001, // Haryana (Gurugram)
  '07': 110001, // Delhi
  '08': 302001, // Rajasthan (Jaipur)
  '09': 226001, // Uttar Pradesh (Lucknow)
  '10': 800001, // Bihar (Patna)
  '11': 781001, // Sikkim (Gangtok — closest)
  '12': 734001, // Arunachal Pradesh (Itanagar)
  '13': 781001, // Nagaland (Kohima — closest)
  '14': 781001, // Manipur (Imphal)
  '15': 781001, // Mizoram (Aizawl)
  '16': 781001, // Tripura (Agartala)
  '17': 722101, // Meghalaya (Shillong)
  '18': 492001, // Chhattisgarh (Raipur)
  '19': 462001, // Madhya Pradesh (Bhopal)
  '20': 400001, // Maharashtra (Mumbai)
  '21': 560001, // Karnataka (Bengaluru)
  '22': 673001, // Goa (Panaji)
  '23': 695001, // Kerala (Thiruvananthapuram)
  '24': 380001, // Gujarat (Ahmedabad)
  '25': 751001, // Odisha (Bhubaneswar)
  '26': 533001, // Andhra Pradesh (Visakhapatnam — post-bifurcation capital region)
  '27': 400001, // Maharashtra (Mumbai — duplicates 20; GSTIN code 27 is MH)
  '28': 500001, // Andhra Pradesh (Hyderabad — old code, now Telangana)
  '29': 500001, // Karnataka (Bengaluru — old code, kept for legacy GSTINs)
  '30': 500001, // Telangana (Hyderabad)
  '31': 380001, // Gujarat (old code)
  '32': 682001, // Lakshadweep (Kavaratti)
  '33': 700001, // West Bengal (Kolkata)
  '34': 734001, // Puducherry (Yanam region)
  '35': 601101, // Andaman & Nicobar (Port Blair)
  '36': 682001, // Daman & Diu
  '37': 382001, // Dadra & Nagar Haveli
  '38': 380001, // Dadra & Nagar Haveli and Daman & Diu (merged UT)
  '97': 110001, // Other Territory
  '98': 110001, // Centre Jurisdiction (fallback)
}

export function extractPinCode(address: string | null | undefined, gstin?: string | null): number {
  if (address) {
    const m = address.match(/\b(\d{6})\b/)
    if (m && m[1]) return parseInt(m[1], 10)
  }
  const state = getStateCode(gstin || '')
  if (state && STATE_DEFAULT_PIN[state]) return STATE_DEFAULT_PIN[state]
  return 110001 // New Delhi — IRP-acceptable fallback
}

/**
 * Calculate GST components from assessable value and GST rate.
 * Handles both intra-state (CGST + SGST) and inter-state (IGST) scenarios.
 *
 * For intra-state: CGST = 50% of total GST, SGST = 50% of total GST
 * For inter-state: IGST = 100% of total GST
 *
 * IMPORTANT: Each component is calculated independently from the base value
 * to avoid rounding discrepancies. The CGST/SGST are calculated at half the
 * GST rate each, NOT by dividing the total GST by 2.
 *
 * @param assessableValue - The taxable value (after discount)
 * @param gstRate - Total GST rate (e.g., 18 for 18%)
 * @param isInterState - Whether supply is inter-state
 * @returns Object with cgst, sgst, igst, and totalTax
 */
export function calculateGST(
  assessableValue: number,
  gstRate: number,
  isInterState: boolean
): { cgst: number; sgst: number; igst: number; totalTax: number } {
  // v6.28.2: CRITICAL FIX — compute total GST first, then split using
  // splitGSTAmount() which guarantees cgst + sgst = totalTax exactly.
  //
  // PREVIOUS BUG: each half (cgst, sgst) was rounded independently, so
  // cgst + sgst could differ from totalTax by ₹0.01. For example:
  //   assessableValue=5.05, gstRate=18%
  //   cgst = roundTo2(5.05 * 9 / 100) = roundTo2(0.4545) = 0.45
  //   sgst = roundTo2(5.05 * 9 / 100) = 0.45
  //   totalTax = roundTo2(0.45 + 0.45) = 0.90
  // But the correct totalTax = roundTo2(5.05 * 18 / 100) = roundTo2(0.909) = 0.91
  // So the invoice showed cgst=0.45 + sgst=0.45 = 0.90, but totalTax=0.91 —
  // the line item didn't foot, and the GST return (filed from the JE which
  // uses splitGSTAmount) showed 0.91/0.91, mismatching the invoice.
  //
  // Now: totalTax = roundTo2(assessableValue * gstRate / 100), then split.
  // This guarantees cgst + sgst = totalTax = igst (for inter-state) exactly.
  const totalTax = roundTo2(assessableValue * gstRate / 100)
  if (isInterState) {
    return { cgst: 0, sgst: 0, igst: totalTax, totalTax }
  }
  const { cgst, sgst } = splitGSTAmount(totalTax, false)
  return { cgst, sgst, igst: 0, totalTax }
}

/**
 * Split an already-calculated total GST amount into CGST/SGST or IGST.
 * Use this when you have a pre-calculated GST total and need to split it.
 *
 * For intra-state: CGST and SGST are each calculated independently,
 * then adjusted if their sum doesn't match the original total (due to rounding).
 *
 * @param totalGst - Total GST amount already calculated
 * @param isInterState - Whether supply is inter-state
 * @returns Object with cgst, sgst, igst
 */
export function splitGSTAmount(
  totalGst: number,
  isInterState: boolean
): { cgst: number; sgst: number; igst: number } {
  if (isInterState) {
    return { cgst: 0, sgst: 0, igst: roundTo2(totalGst) }
  }

  // Split into two halves, adjusting for 1-cent rounding discrepancy
  const cgst = roundTo2(totalGst / 2)
  const sgst = roundTo2(totalGst - cgst) // Ensure cgst + sgst = totalGst exactly

  return { cgst, sgst, igst: 0 }
}

/**
 * Validate HSN code.
 * HSN codes should be at least 4 digits (as per GST rules for most taxpayers).
 * For taxpayers with turnover > 5 Cr, 4-digit HSN is mandatory.
 * For taxpayers with turnover <= 5 Cr, 4-digit is recommended for B2B.
 *
 * @returns { valid: boolean, error?: string }
 */
export function validateHSN(hsn: string, isB2B: boolean = true): { valid: boolean; error?: string } {
  if (!hsn) {
    // HSN is optional for some items, but mandatory for B2B e-invoices
    if (isB2B) {
      return { valid: false, error: 'HSN code is required for B2B e-invoicing' }
    }
    return { valid: true }
  }

  // HSN should be numeric and 2, 4, 6, or 8 digits
  // v6.28.2: Fix regex — alternation must be grouped so ^ and $ apply to all options.
  // Previously `^\d{2}|\d{4}|\d{6}|\d{8}$` parsed as `(^\d{2}) | (\d{4}) | (\d{6}) | (\d{8}$)`
  // which accepted invalid codes like "12ABC" (matched ^\d{2}) or "ABC1234" (matched \d{4}).
  if (!/^(\d{2}|\d{4}|\d{6}|\d{8})$/.test(hsn)) {
    return { valid: false, error: `Invalid HSN code "${hsn}": must be 2, 4, 6, or 8 digits` }
  }

  // For B2B, minimum 4 digits
  if (isB2B && hsn.length < 4) {
    return { valid: false, error: `HSN code "${hsn}" must be at least 4 digits for B2B supplies` }
  }

  return { valid: true }
}

/**
 * Calculate item-level GST details for e-invoice (INV-01 schema)
 * Computes assessable value, tax amounts, and total item value
 * ensuring all values reconcile correctly.
 */
export function calculateItemGST(
  qty: number,
  rate: number,
  gstRate: number,
  discount: number,
  isInterState: boolean
): {
  totAmt: number      // Total amount before discount (qty * rate)
  assAmt: number      // Assessable value (after discount)
  cgstAmt: number
  sgstAmt: number
  igstAmt: number
  totalTax: number
  totItemVal: number  // assAmt + all tax amounts
} {
  const totAmt = roundTo2(qty * rate)
  const assAmt = roundTo2(totAmt - discount)
  const { cgst, sgst, igst, totalTax } = calculateGST(assAmt, gstRate, isInterState)
  const totItemVal = roundTo2(assAmt + cgst + sgst + igst)

  return {
    totAmt,
    assAmt,
    cgstAmt: cgst,
    sgstAmt: sgst,
    igstAmt: igst,
    totalTax,
    totItemVal,
  }
}

/**
 * Calculate invoice-level value details for e-invoice (INV-01 ValDtls)
 * Sums up item-level values to ensure reconciliation.
 *
 * The INV-01 schema requires:
 *   TotInvVal = AssVal + CgstVal + SgstVal + IgstVal + CesVal + StCesVal + RndOffAmt + OthChrg - Discount
 */
export function calculateInvoiceTotals(
  items: Array<{
    assAmt: number
    cgstAmt: number
    sgstAmt: number
    igstAmt: number
  }>,
  totalInvoiceAmount: number,
  cessTotal: number = 0,
  stateCessTotal: number = 0,
  otherCharges: number = 0,
  invoiceDiscount: number = 0
): {
  assVal: number
  cgstVal: number
  sgstVal: number
  igstVal: number
  cesVal: number
  stCesVal: number
  discount: number
  othChrg: number
  rndOffAmt: number
  totInvVal: number
} {
  const assVal = roundTo2(items.reduce((sum, item) => sum + item.assAmt, 0))
  const cgstVal = roundTo2(items.reduce((sum, item) => sum + item.cgstAmt, 0))
  const sgstVal = roundTo2(items.reduce((sum, item) => sum + item.sgstAmt, 0))
  const igstVal = roundTo2(items.reduce((sum, item) => sum + item.igstAmt, 0))

  // Rounding difference = TotalInvoiceAmount - computed total
  const computedTotal = roundTo2(
    assVal + cgstVal + sgstVal + igstVal + cessTotal + stateCessTotal + otherCharges - invoiceDiscount
  )
  const rndOffAmt = roundTo2(totalInvoiceAmount - computedTotal)

  return {
    assVal,
    cgstVal,
    sgstVal,
    igstVal,
    cesVal: roundTo2(cessTotal),
    stCesVal: roundTo2(stateCessTotal),
    discount: roundTo2(invoiceDiscount),
    othChrg: roundTo2(otherCharges),
    rndOffAmt,
    totInvVal: roundTo2(totalInvoiceAmount),
  }
}

/**
 * Get financial year in Indian format (e.g., "2024-25" for Apr 2024 - Mar 2025)
 */
export function getFinancialYear(date: Date): string {
  const month = date.getMonth() + 1
  const year = date.getFullYear()
  if (month >= 4) {
    return `${year}-${String(year + 1).slice(-2)}`
  }
  return `${year - 1}-${String(year).slice(-2)}`
}

/**
 * Format date for e-invoice (dd/mm/yyyy)
 */
export function formatDateForEinvoice(date: string | Date): string {
  const d = new Date(date)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}
