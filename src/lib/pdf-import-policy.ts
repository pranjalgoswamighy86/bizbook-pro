export const MAX_PDF_IMPORT_PAGES = 20
export const MAX_PDF_IMPORT_TEXT_CHARS = 30000

/**
 * Treat a PDF as scanned when its embedded text is too sparse for its page
 * count. This also catches image-only and mostly-image PDFs with tiny metadata.
 */
export function isLikelyScannedPdf(text: string, pageCount: number): boolean {
  const normalizedLength = String(text || '').replace(/\s/g, '').length
  return normalizedLength < Math.max(20, Math.max(1, pageCount) * 20)
}

/** Return a bounded text preview and an explicit truncation flag. */
export function preparePdfText(text: string, maxChars = MAX_PDF_IMPORT_TEXT_CHARS): {
  content: string
  truncated: boolean
} {
  const source = String(text || '')
  const limit = Math.max(0, Math.floor(maxChars))
  return { content: source.slice(0, limit), truncated: source.length > limit }
}
