// exportToExcel has been moved to @/lib/excel-export.ts
// to avoid bundling the xlsx library (~800KB) into the main client chunk.
// Import it from there if you need Excel export functionality.
// import { exportToExcel } from '@/lib/excel-export'

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const VALID_CURRENCIES = new Set([
  'INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY', 'CNY',
  'CHF', 'NZD', 'ZAR', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'MYR', 'THB',
  'BDT', 'LKR', 'NPR', 'PKR', 'MMK', 'IDR', 'PHP', 'VND', 'KRW', 'TWD',
  'BRL', 'MXN', 'ARS', 'CLP', 'COP', 'PEN', 'UYU', 'EGP', 'NGN', 'KES',
  'MAD', 'TND', 'DZD', 'ETB', 'GHS', 'TZS', 'UGX', 'RUB', 'UAH', 'PLN',
  'CZK', 'HUF', 'RON', 'BGN', 'HRK', 'RSD', 'TRY', 'ILS', 'JOD', 'LBP',
  'IQD', 'AFN', 'TJS', 'UZS', 'KZT', 'AZN', 'GEL', 'AMD',
])

export function formatCurrency(amount: number, currency: string = 'INR'): string {
  // Guard against invalid/empty currency codes that would throw RangeError
  // e.g., tenant.currency could be "" or malformed after DB migration
  const safeCurrency = (currency && VALID_CURRENCIES.has(currency.toUpperCase()))
    ? currency.toUpperCase()
    : 'INR'
  const safeAmount = Number.isFinite(amount) ? amount : 0
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: safeCurrency,
      minimumFractionDigits: 2,
    }).format(safeAmount)
  } catch {
    // Ultimate fallback if Intl still fails
    return `₹${safeAmount.toFixed(2)}`
  }
}

export function getDateFilterRange(filter: { type: string; startDate?: string; endDate?: string }) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  switch (filter.type) {
    case 'today':
      return { start: today, end: new Date(today.getTime() + 86400000) }
    case 'week': {
      const dayOfWeek = today.getDay()
      const startOfWeek = new Date(today.getTime() - dayOfWeek * 86400000)
      return { start: startOfWeek, end: new Date(startOfWeek.getTime() + 7 * 86400000) }
    }
    case 'month': {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      return { start: startOfMonth, end: endOfMonth }
    }
    case 'quarter': {
      const quarter = Math.floor(now.getMonth() / 3)
      const startOfQuarter = new Date(now.getFullYear(), quarter * 3, 1)
      const endOfQuarter = new Date(now.getFullYear(), (quarter + 1) * 3, 1)
      return { start: startOfQuarter, end: endOfQuarter }
    }
    case 'year': {
      const startOfYear = new Date(now.getFullYear(), 0, 1)
      const endOfYear = new Date(now.getFullYear() + 1, 0, 1)
      return { start: startOfYear, end: endOfYear }
    }
    case 'custom': {
      const start = filter.startDate ? new Date(filter.startDate) : new Date(0)
      const end = filter.endDate ? new Date(new Date(filter.endDate).getTime() + 86400000) : new Date()
      return { start, end }
    }
    default:
      return { start: new Date(0), end: new Date() }
  }
}
