/**
 * Pure per-tenant GSP credential encryption helpers.
 * Ciphertext format: v1:<base64(iv || authTag || ciphertext)>.
 * GSP_CREDENTIALS_ENCRYPTION_KEY must be exactly 32 random bytes encoded as
 * 64 hexadecimal characters. There is deliberately no plaintext fallback.
 */
import crypto from 'crypto'

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

export function isEncryptionActive(): boolean {
  try { getEncryptionKey(); return true } catch { return false }
}
