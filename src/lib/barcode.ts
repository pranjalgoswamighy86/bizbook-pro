/**
 * Lightweight Code128 Barcode Encoder
 * Generates an SVG string from a given text value.
 * No external dependencies required.
 *
 * Code128 encoding supports three code sets:
 * - Code Set A: uppercase + control chars
 * - Code Set B: uppercase + lowercase + common symbols
 * - Code Set C: numeric pairs (00-99) — most efficient for digits
 *
 * This implementation uses Code Set B for mixed content and Code Set C
 * for pure numeric content of even length >= 4 digits.
 */

// Code128 pattern table: each entry is the bar pattern (6 elements per symbol)
// represented as widths of bars and spaces alternating
const CODE128_PATTERNS: string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232',
  // Stop pattern is special (7 elements)
]

const CODE128_STOP = '2331112'

// Start codes
const START_A = 103
const START_B = 104
const START_C = 105

/**
 * Encode a string using Code128 (auto-selects Code Set B or C)
 */
function encodeCode128(text: string): number[] {
  const codes: number[] = []

  // Decide: use Code Set C if text is all digits and even length >= 4
  const allDigits = /^\d+$/.test(text)
  const useCodeC = allDigits && text.length >= 4 && text.length % 2 === 0

  if (useCodeC) {
    codes.push(START_C)
    for (let i = 0; i < text.length; i += 2) {
      codes.push(parseInt(text.substring(i, i + 2), 10))
    }
  } else {
    codes.push(START_B)
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i)
      if (charCode >= 32 && charCode <= 127) {
        codes.push(charCode - 32)
      } else {
        // Fallback for non-ASCII: replace with space
        codes.push(0)
      }
    }
  }

  // Calculate checksum
  let checksum = codes[0]
  for (let i = 1; i < codes.length; i++) {
    checksum += codes[i] * i
  }
  codes.push(checksum % 103)

  // Stop code
  codes.push(106)

  return codes
}

/**
 * Convert a Code128 pattern string to SVG path bars
 */
function patternToBars(pattern: string, x: number, moduleWidth: number, height: number): string {
  let svg = ''
  let currentX = x
  let isBar = true // alternate between bar and space

  for (let i = 0; i < pattern.length; i++) {
    const width = parseInt(pattern[i], 10) * moduleWidth
    if (isBar) {
      svg += `<rect x="${currentX.toFixed(2)}" y="0" width="${width.toFixed(2)}" height="${height}" fill="black"/>`
    }
    currentX += width
    isBar = !isBar
  }

  return svg
}

/**
 * Generate a Code128 barcode as an SVG string
 * @param text - The text to encode
 * @param options - Optional configuration
 * @returns SVG string
 */
export function generateBarcodeSvg(
  text: string,
  options: {
    width?: number
    height?: number
    showText?: boolean
    fontSize?: number
  } = {}
): string {
  const {
    width = 200,
    height = 60,
    showText = true,
    fontSize = 12,
  } = options

  if (!text || text.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + (showText ? fontSize + 4 : 0)}"></svg>`
  }

  const codes = encodeCode128(text)

  // Calculate total module width
  const quietZone = 10 // quiet zone on each side
  let totalModules = 0
  for (const code of codes) {
    if (code === 106) {
      totalModules += 7 // stop pattern has 7 elements
    } else {
      totalModules += 6 // normal patterns have 6 elements
    }
  }

  // Each element is 1-4 modules wide; calculate actual module count from patterns
  let moduleCount = 0
  for (const code of codes) {
    const pattern = code === 106 ? CODE128_STOP : CODE128_PATTERNS[code]
    for (const ch of pattern) {
      moduleCount += parseInt(ch, 10)
    }
  }

  const moduleWidth = (width - 2 * quietZone) / moduleCount
  const totalWidth = moduleCount * moduleWidth + 2 * quietZone

  // Build SVG
  let svgContent = ''
  let currentX = quietZone
  const barHeight = showText ? height - fontSize - 4 : height

  for (const code of codes) {
    const pattern = code === 106 ? CODE128_STOP : CODE128_PATTERNS[code]
    svgContent += patternToBars(pattern, currentX, moduleWidth, barHeight)

    // Advance x position
    for (const ch of pattern) {
      currentX += parseInt(ch, 10) * moduleWidth
    }
  }

  const textY = barHeight + fontSize + 2
  const textSvg = showText
    ? `<text x="${(totalWidth / 2).toFixed(2)}" y="${textY}" text-anchor="middle" font-family="monospace" font-size="${fontSize}" fill="black">${escapeXml(text)}</text>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth.toFixed(2)}" height="${height + (showText ? fontSize + 4 : 0)}" viewBox="0 0 ${totalWidth.toFixed(2)} ${height + (showText ? fontSize + 4 : 0)}">${svgContent}${textSvg}</svg>`
}

/**
 * Generate a random barcode string (numeric, 12 digits for EAN-like)
 */
export function generateRandomBarcode(): string {
  const digits = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('')
  return digits
}

/**
 * Generate barcode from SKU or random number
 */
export function generateBarcodeFromSku(sku: string | null | undefined): string {
  if (sku && sku.trim().length > 0) {
    // Use SKU as barcode base, padded/trimmed to reasonable length
    const cleaned = sku.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
    return cleaned.length >= 4 ? cleaned : cleaned + String(Date.now()).slice(-8)
  }
  return generateRandomBarcode()
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
