/**
 * Per-tenant GSP credential storage.
 * Ciphertext format: v1:<base64(iv || authTag || ciphertext)>.
 * GSP_CREDENTIALS_ENCRYPTION_KEY must be exactly 32 random bytes encoded as
 * 64 hexadecimal characters. There is deliberately no plaintext fallback.
 */
import crypto from 'crypto'
import { db } from '@/lib/db-soft-delete'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16
const CIPHERTEXT_PREFIX = 'v1:'

function getEncryptionKey(): Buffer {
  const value = process.env.GSP_CREDENTIALS_ENCRYPTION_KEY
  if (!value || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('GSP credential encryption is unavailable: configure a valid 32-byte key.')
  }
  return Buffer.from(value, 'hex')
}

export function encryptCredential(plaintext: string): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) throw new Error('Cannot encrypt an empty GSP credential.')
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return CIPHERTEXT_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')
}

export function decryptCredential(value: string): string {
  if (typeof value !== 'string' || !value.startsWith(CIPHERTEXT_PREFIX)) {
    throw new Error('Stored GSP credential is missing or uses an unsupported format.')
  }
  try {
    const packed = Buffer.from(value.slice(CIPHERTEXT_PREFIX.length), 'base64')
    if (packed.length <= IV_LENGTH + TAG_LENGTH) throw new Error('Invalid ciphertext length')
    const iv = packed.subarray(0, IV_LENGTH)
    const tag = packed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
    const encrypted = packed.subarray(IV_LENGTH + TAG_LENGTH)
    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Unable to decrypt stored GSP credentials. Verify the configured key and credential record.')
  }
}

export interface TenantGspConfig {
  tenantId: string
  gspCode: string
  gspClientId: string
  gspClientSecret: string
  gspUsername: string
  gspPassword: string
  irpEnv: string
}

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

export function isEncryptionActive(): boolean {
  try { getEncryptionKey(); return true } catch { return false }
}

/** Tenant credentials only. Global IRP_GSP_* fallback is intentionally removed. */
export async function getEffectiveGspConfig(tenantId: string): Promise<TenantGspConfig | null> {
  return loadTenantGspConfig(tenantId)
}
