/**
 * Per-tenant GSP credential storage.
 * Ciphertext format: v1:<base64(iv || authTag || ciphertext)>.
 * GSP_CREDENTIALS_ENCRYPTION_KEY must be exactly 32 random bytes encoded as
 * 64 hexadecimal characters. There is deliberately no plaintext fallback.
 */
import type { TenantGspConfig } from './gsp-config-types'
export type { TenantGspConfig } from './gsp-config-types'
import { db } from '@/lib/db-soft-delete'
import { decryptCredential, encryptCredential } from './gsp-credential-crypto'
export { decryptCredential, encryptCredential, isEncryptionActive } from './gsp-credential-crypto'
export async function loadTenantGspConfig(tenantId: string): Promise<TenantGspConfig | null> {
  const tenant = await db.tenant.findFirst({
    where: { id: tenantId },
    select: { id: true, gspCode: true, gspClientIdEnc: true, gspClientSecretEnc: true,
      gspUsernameEnc: true, gspPasswordEnc: true, irpEnv: true },
  })
  if (!tenant) return null
  const fields = [tenant.gspCode, tenant.gspClientIdEnc, tenant.gspClientSecretEnc, tenant.gspUsernameEnc, tenant.gspPasswordEnc]
  if (fields.every(value => !value)) return null
  if (fields.some(value => typeof value !== 'string' || !value)) {
    throw new Error('GSP configuration is incomplete. Re-save the credentials in Settings.')
  }
  return {
    tenantId: tenant.id,
    gspCode: tenant.gspCode!,
    gspClientId: decryptCredential(tenant.gspClientIdEnc!),
    gspClientSecret: decryptCredential(tenant.gspClientSecretEnc!),
    gspUsername: decryptCredential(tenant.gspUsernameEnc!),
    gspPassword: decryptCredential(tenant.gspPasswordEnc!),
    irpEnv: tenant.irpEnv || 'sandbox',
  }
}

export async function tenantHasGspCredentials(tenantId: string): Promise<boolean> {
  const tenant = await db.tenant.findFirst({
    where: { id: tenantId },
    select: { gspCode: true, gspClientIdEnc: true, gspClientSecretEnc: true, gspUsernameEnc: true, gspPasswordEnc: true },
  })
  return !!(tenant?.gspCode && tenant.gspClientIdEnc && tenant.gspClientSecretEnc && tenant.gspUsernameEnc && tenant.gspPasswordEnc)
}

export async function saveTenantGspConfig(tenantId: string, config: {
  gspCode: string; gspClientId: string; gspClientSecret: string; gspUsername: string; gspPassword: string; irpEnv?: string
}): Promise<void> {
  const encrypted = {
    gspClientIdEnc: encryptCredential(config.gspClientId),
    gspClientSecretEnc: encryptCredential(config.gspClientSecret),
    gspUsernameEnc: encryptCredential(config.gspUsername),
    gspPasswordEnc: encryptCredential(config.gspPassword),
  }
  await db.tenant.update({
    where: { id: tenantId },
    data: { gspCode: config.gspCode.trim(), ...encrypted,
      irpEnv: config.irpEnv === 'production' ? 'production' : 'sandbox', gspConfigUpdatedAt: new Date() },
  })
}

export async function clearTenantGspConfig(tenantId: string): Promise<void> {
  await db.tenant.update({
    where: { id: tenantId },
    data: { gspCode: null, gspClientIdEnc: null, gspClientSecretEnc: null,
      gspUsernameEnc: null, gspPasswordEnc: null, gspConfigUpdatedAt: null },
  })
}

export function getBaseUrlForEnv(irpEnv: string): string {
  return irpEnv === 'production' ? 'https://einvoice.gst.gov.in' : 'https://einvoice1.traces.gov.in'
}


/** Tenant credentials only. Global IRP_GSP_* fallback is intentionally removed. */
export async function getEffectiveGspConfig(tenantId: string): Promise<TenantGspConfig | null> {
  return loadTenantGspConfig(tenantId)
}
