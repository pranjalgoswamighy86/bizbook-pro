/**
 * Shared server-side allowlist for system administrator access.
 *
 * ADMIN_BYPASS_EMAILS accepts a comma-, semicolon-, or whitespace-separated
 * list. The individual variables remain supported for backwards compatibility.
 */
export function getSystemAdminEmails(): Set<string> {
  const configuredList = (process.env.ADMIN_BYPASS_EMAILS || '')
    .split(/[,;\s]+/)
    .map(value => value.toLowerCase().trim())
    .filter(Boolean)

  const individualEmails = [
    process.env.ADMIN_EMAIL,
    process.env.INFRA_OWNER_EMAIL,
    process.env.INFRASTRUCTURE_OWNER_EMAIL,
  ]
    .map(value => (value || '').toLowerCase().trim())
    .filter(Boolean)

  return new Set([...configuredList, ...individualEmails])
}

export function isSystemAdminEmail(email: string | null | undefined): boolean {
  const normalizedEmail = (email || '').toLowerCase().trim()
  return Boolean(normalizedEmail) && getSystemAdminEmails().has(normalizedEmail)
}
