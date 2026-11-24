/**
 * v6.32.0: Per-Tenant GSP Credential Management
 * ============================================================
 * Each customer (tenant) stores their OWN GSP credentials — encrypted at rest
 * using AES-256-GCM. This replaces the shared global process.env.IRP_GSP_*
 * variables, which were unsuitable for a multi-customer ERP where every
 * customer must use their own authorised GST identity.
 *
 * Encryption:
 *   - Algorithm: AES-256-GCM (authenticated encryption)
 *   - Key: 32-byte key derived from GSP_CREDENTIALS_ENCRYPTION_KEY env var
 *   - If env var is not set, credentials are stored in plaintext (dev only)
 *   - Each encryption uses a random IV, so identical plaintexts produce
 *     different ciphertexts
 *
 * Flow:
 *   1. Tenant admin enters GSP credentials in Settings → saved encrypted
 *   2. When IRN/EWB generation is needed, loadTenantGspConfig() decrypts
 *   3. Decrypted credentials are passed to irp-integration.ts / ewb-integration.ts
 *   4. Decrypted credentials are NEVER logged or persisted in audit logs
 */

import crypto from 'crypto'
import { db } from '@/lib/db-soft-delete'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // GCM standard IV length
const TAG_LENGTH = 16

/**
 * Get the encryption key from env var. Derives a 32-byte key using SHA-256
 * so any-length passphrase works. Returns null if no key is set (dev mode).
 */
function getEncryptionKey(): Buffer | null {
  const envKey = process.env.GSP_CREDENTIALS_ENCRYPTION_KEY
  if (!envKey) return null
  return crypto.createHash('sha256').update(envKey).digest()
}

/**
 * Encrypt a plaintext string for storage in the database.
 * Returns a base64 string containing IV + ciphertext + auth tag.
 * If no encryption key is set, returns plaintext (development mode only).
 */
export function encryptCredential(plaintext: string): string {
  if (!plaintext) return ''
  const key = getEncryptionKey()
  if (!key) {
    // Development mode — no encryption key set
    return plaintext
  }

  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  // Pack: IV (12 bytes) + tag (16 bytes) + ciphertext
  const packed = Buffer.concat([iv, tag, encrypted])
  return packed.toString('base64')
}

/**
 * Decrypt a stored credential back to plaintext.
 * Returns the original plaintext, or empty string if decryption fails.
 * If no encryption key is set, returns input as-is (dev mode).
 */
export function decryptCredential(ciphertext: string): string {
  if (!ciphertext) return ''
  const key = getEncryptionKey()
  if (!key) {
    // Development mode — no encryption was applied
    return ciphertext
  }

  try {
    const packed = Buffer.from(ciphertext, 'base64')
    const iv = packed.subarray(0, IV_LENGTH)
    const tag = packed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
    const encrypted = packed.subarray(IV_LENGTH + TAG_LENGTH)

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
    return decrypted.toString('utf8')
  } catch (err) {
    console.error('[GSP-CRED] Decryption failed:', err)
    return ''
  }
}

/**
 * Interface for decrypted GSP credentials — passed to IRP/EWB integration.
 */
export interface TenantGspConfig {
  gspCode: string
  gspClientId: string
  gspClientSecret: string
  gspUsername: string
  gspPassword: string
  irpEnv: string // 'sandbox' or 'production'
}

/**
 * Load and decrypt a tenant's GSP credentials from the database.
 * Returns null if the tenant has not configured their own credentials.
 *
 * @param tenantId - The customer's tenant ID
 * @returns Decrypted GSP config, or null if not configured
 */
export async function loadTenantGspConfig(tenantId: string): Promise<TenantGspConfig | null> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: {
      gspCode: true,
      gspClientIdEnc: true,
      gspClientSecretEnc: true,
      gspUsernameEnc: true,
      gspPasswordEnc: true,
      irpEnv: true,
    },
  })

  if (!tenant) return null

  // All four credential fields must be present for a valid config
  if (!tenant.gspCode || !tenant.gspClientIdEnc || !tenant.gspClientSecretEnc ||
      !tenant.gspUsernameEnc || !tenant.gspPasswordEnc) {
    return null
  }

  return {
    gspCode: tenant.gspCode,
    gspClientId: decryptCredential(tenant.gspClientIdEnc),
    gspClientSecret: decryptCredential(tenant.gspClientSecretEnc),
    gspUsername: decryptCredential(tenant.gspUsernameEnc),
    gspPassword: decryptCredential(tenant.gspPasswordEnc),
    irpEnv: tenant.irpEnv || 'sandbox',
  }
}

/**
 * Check whether a tenant has their own GSP credentials configured.
 * Does NOT decrypt — just checks if the encrypted fields are non-empty.
 */
export async function tenantHasGspCredentials(tenantId: string): Promise<boolean> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: {
      gspCode: true,
      gspClientIdEnc: true,
      gspClientSecretEnc: true,
      gspUsernameEnc: true,
      gspPasswordEnc: true,
    },
  })

  if (!tenant) return false
  return !!(tenant.gspCode && tenant.gspClientIdEnc && tenant.gspClientSecretEnc &&
            tenant.gspUsernameEnc && tenant.gspPasswordEnc)
}

/**
 * Save (encrypt + persist) a tenant's GSP credentials.
 * Used by the Settings page when a customer enters their GSP details.
 *
 * @param tenantId - The customer's tenant ID
 * @param config - Plaintext GSP credentials to encrypt and store
 */
export async function saveTenantGspConfig(
  tenantId: string,
  config: {
    gspCode: string
    gspClientId: string
    gspClientSecret: string
    gspUsername: string
    gspPassword: string
    irpEnv?: string
  }
): Promise<void> {
  await db.tenant.update({
    where: { id: tenantId },
    data: {
      gspCode: config.gspCode,
      gspClientIdEnc: encryptCredential(config.gspClientId),
      gspClientSecretEnc: encryptCredential(config.gspClientSecret),
      gspUsernameEnc: encryptCredential(config.gspUsername),
      gspPasswordEnc: encryptCredential(config.gspPassword),
      irpEnv: config.irpEnv || 'sandbox',
    },
  })
}

/**
 * Clear a tenant's GSP credentials (set all fields to null).
 * Used when a customer wants to revoke GSP access.
 */
export async function clearTenantGspConfig(tenantId: string): Promise<void> {
  await db.tenant.update({
    where: { id: tenantId },
    data: {
      gspCode: null,
      gspClientIdEnc: null,
      gspClientSecretEnc: null,
      gspUsernameEnc: null,
      gspPasswordEnc: null,
    },
  })
}

/**
 * Get the base URL for IRP/EWB API calls based on the tenant's environment.
 */
export function getBaseUrlForEnv(irpEnv: string): string {
  return irpEnv === 'production'
    ? 'https://einvoice.gst.gov.in'
    : 'https://einvoice1.traces.gov.in'
}

/**
 * Check whether encryption is active (key is set in env var).
 * Returns true if credentials are being encrypted at rest.
 */
export function isEncryptionActive(): boolean {
  return !!process.env.GSP_CREDENTIALS_ENCRYPTION_KEY
}

/**
 * Get the effective GSP configuration for a tenant.
 * Falls back to global env vars if tenant has no own credentials configured
 * (backward compatibility for existing deployments).
 *
 * @param tenantId - The customer's tenant ID
 * @returns Tenant config if set, or global env var config, or null
 */
export async function getEffectiveGspConfig(tenantId: string): Promise<TenantGspConfig | null> {
  // Try tenant-specific credentials first
  const tenantConfig = await loadTenantGspConfig(tenantId)
  if (tenantConfig) return tenantConfig

  // Fall back to global env vars (backward compat)
  if (process.env.IRP_GSP_CODE && process.env.IRP_GSP_CLIENT_ID &&
      process.env.IRP_GSP_CLIENT_SECRET && process.env.IRP_GSP_USERNAME &&
      process.env.IRP_GSP_PASSWORD) {
    return {
      gspCode: process.env.IRP_GSP_CODE,
      gspClientId: process.env.IRP_GSP_CLIENT_ID,
      gspClientSecret: process.env.IRP_GSP_CLIENT_SECRET,
      gspUsername: process.env.IRP_GSP_USERNAME,
      gspPassword: process.env.IRP_GSP_PASSWORD,
      irpEnv: process.env.IRP_ENV || 'sandbox',
    }
  }

  return null
}
