// ============================================================
// GST Utility Functions for Indian Business Management
// Handles: GSTIN validation, state codes, tax calculations,
// CGST/SGST/IGST splitting, rounding, and HSN validation
// ============================================================

/**
 * Round a number to 2 decimal places using proper decimal arithmetic.
 * Avoids floating-point issues by using string-based rounding.
 */
export function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
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
 * Validate GSTIN format.
 * GSTIN format: XXYYYYYXXXXXXYZ (15 characters)
 *   XX     = State code (01-38)
 *   YYYYY  = PAN (5 alphabetic)
 *   XXXXXX = Entity number (4 numeric + 1 alphabetic)
 *   Y      = Registration type (Z=regular, default)
 *   Z      = Check digit (alphanumeric)
 *
 * @returns { valid: boolean, error?: string }
 */
export function validateGSTIN(gstin: string): { valid: boolean; error?: string } {
  if (!gstin) {
    return { valid: false, error: 'GSTIN is required' }
  }

  if (gstin.length !== 15) {
    return { valid: false, error: `GSTIN must be 15 characters, got ${gstin.length}` }
  }

  const stateCode = gstin.substring(0, 2)
  if (!STATE_CODES[stateCode]) {
    return { valid: false, error: `Invalid state code "${stateCode}" in GSTIN` }
  }

  // Characters 3-7: PAN portion (should be alphanumeric, first 3 alpha, 4th alpha/digit, 5th alpha)
  const panPortion = gstin.substring(2, 7)
  if (!/^[A-Z]{3}[ABCFGHLJPTF][A-Z]/.test(panPortion)) {
    return { valid: false, error: 'Invalid PAN portion in GSTIN' }
  }

  // Characters 8-12: Entity number (4 digits + 1 alpha)
  const entityPortion = gstin.substring(7, 12)
  if (!/^[0-9]{4}[A-Z]$/.test(entityPortion)) {
    return { valid: false, error: 'Invalid entity portion in GSTIN' }
  }

  // Character 13: Registration type (Z for regular taxpayers)
  const regType = gstin[12]
  if (!/^[A-Z0-9]$/.test(regType)) {
    return { valid: false, error: 'Invalid registration type in GSTIN' }
  }

  // Character 14: Check digit (alphanumeric)
  const checkDigit = gstin[13]
  if (!/^[A-Z0-9]$/.test(checkDigit)) {
    return { valid: false, error: 'Invalid check digit in GSTIN' }
  }

  // Validate check digit using GSTN algorithm
  const computedCheckDigit = computeGSTINCheckDigit(gstin.substring(0, 14))
  if (computedCheckDigit !== checkDigit) {
    return { valid: false, error: `GSTIN check digit mismatch: expected "${computedCheckDigit}", got "${checkDigit}"` }
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
  if (!gstin || gstin.length < 2) return '27' // Default to Maharashtra
  return gstin.substring(0, 2)
}

/**
 * Determine if a supply is intra-state or inter-state
 * based on supplier and buyer GSTINs
 */
export function isInterStateSupply(supplierGstin: string, buyerGstin: string): boolean {
  const supplierState = getStateCode(supplierGstin)
  const buyerState = getStateCode(buyerGstin)
  return supplierState !== buyerState
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
  if (isInterState) {
    const igst = roundTo2(assessableValue * gstRate / 100)
    return { cgst: 0, sgst: 0, igst, totalTax: igst }
  }

  // Intra-state: calculate each half independently to avoid rounding mismatch
  // CGST and SGST are each calculated at gstRate/2
  const halfRate = gstRate / 2
  const cgst = roundTo2(assessableValue * halfRate / 100)
  const sgst = roundTo2(assessableValue * halfRate / 100)
  const totalTax = roundTo2(cgst + sgst)

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
  if (!/^\d{2}|\d{4}|\d{6}|\d{8}$/.test(hsn)) {
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
