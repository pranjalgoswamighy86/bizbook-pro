/**
 * Master Mobile Number + Admin Email Configuration
 *
 * Master Mobile: 9101555075 — bypasses uniqueness check, unlimited registrations
 * Admin Email: admin@bizbook.pro — bypasses ALL OTP verification
 */

export function getMasterMobileNumber(): string {
  return process.env.MASTER_MOBILE_NUMBER || '9101555075'
}

export function normalizeToTenDigits(phone: string): string {
  if (!phone) return ''
  let clean = phone.replace(/[^0-9]/g, '')
  if (clean.length === 12 && clean.startsWith('91')) clean = clean.slice(2)
  if (clean.length === 11 && clean.startsWith('0')) clean = clean.slice(1)
  if (clean.length === 12 && clean.startsWith('91')) clean = clean.slice(2)
  return clean
}

export function isMasterMobile(phone: string): boolean {
  if (!phone) return false
  const master = normalizeToTenDigits(getMasterMobileNumber())
  const candidate = normalizeToTenDigits(phone)
  return master.length === 10 && candidate === master
}

export function getMaskedMasterMobile(): string {
  const master = normalizeToTenDigits(getMasterMobileNumber())
  if (master.length !== 10) return '******'
  return `${master.slice(0, 2)}******${master.slice(-2)}`
}

export function getMasterMobileForSms(): string {
  const master = normalizeToTenDigits(getMasterMobileNumber())
  return `91${master}`
}

export function getAdminEmail(): string {
  return (process.env.ADMIN_EMAIL || 'admin@bizbook.pro').toLowerCase().trim()
}

export function isAdminEmail(email: string): boolean {
  if (!email) return false
  return email.toLowerCase().trim() === getAdminEmail()
}
