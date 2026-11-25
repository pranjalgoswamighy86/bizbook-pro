export function isValidIrpSuccessResult(result: unknown): result is { Irn: string; AckNo: string | number; AckDt: string; SignedQRCode?: string } {
  if (!result || typeof result !== 'object') return false
  const value = result as Record<string, unknown>
  const ackNo = typeof value.AckNo === 'string' || typeof value.AckNo === 'number' ? String(value.AckNo) : ''
  return typeof value.Irn === 'string' &&
    /^[A-Fa-f0-9]{64}$/.test(value.Irn) &&
    ackNo.trim().length > 0 &&
    typeof value.AckDt === 'string' &&
    value.AckDt.trim().length > 0
}

export function isValidEwbNumber(value: unknown): value is string {
  return typeof value === 'string' && /^\\d{12}$/.test(value.trim())
}
