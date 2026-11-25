import test from 'node:test'
import assert from 'node:assert/strict'
import {
  decryptCredential,
  encryptCredential,
  isEncryptionActive,
} from '../.test-build/gsp-credential-crypto.js'

const ENV_KEY = 'GSP_CREDENTIALS_ENCRYPTION_KEY'
const validKey = 'a'.repeat(64)

async function withKey(value, run) {
  const previous = process.env[ENV_KEY]
  if (value === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = value
  try {
    await run()
  } finally {
    if (previous === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = previous
  }
}

test('GSP credential encryption round-trips UTF-8 secrets without storing plaintext', async () => {
  await withKey(validKey, () => {
    const secret = 'client-secret-秘密-🔐'
    const encrypted = encryptCredential(secret)
    assert.match(encrypted, /^v1:/)
    assert.equal(encrypted.includes(secret), false)
    assert.equal(decryptCredential(encrypted), secret)
    assert.equal(isEncryptionActive(), true)
  })
})

test('GSP credential encryption uses a fresh IV for each encryption', async () => {
  await withKey(validKey, () => {
    const first = encryptCredential('same-secret')
    const second = encryptCredential('same-secret')
    assert.notEqual(first, second)
    assert.equal(decryptCredential(first), 'same-secret')
    assert.equal(decryptCredential(second), 'same-secret')
  })
})

test('GSP credential encryption refuses missing, malformed, and incorrectly sized keys', async () => {
  await withKey(undefined, () => {
    assert.equal(isEncryptionActive(), false)
    assert.throws(() => encryptCredential('secret'), /configure a valid 32-byte key/)
  })
  for (const invalidKey of ['not-hex'.padEnd(64, '0'), 'ab'.repeat(31), 'ab'.repeat(33)]) {
    await withKey(invalidKey, () => {
      assert.equal(isEncryptionActive(), false)
      assert.throws(() => encryptCredential('secret'), /configure a valid 32-byte key/)
    })
  }
})

test('GSP credential encryption rejects empty plaintext and unsupported stored formats', async () => {
  await withKey(validKey, () => {
    assert.throws(() => encryptCredential(''), /Cannot encrypt an empty GSP credential/)
    assert.throws(() => decryptCredential('plain-text-secret'), /unsupported format/)
    assert.throws(() => decryptCredential('v2:YWJj'), /unsupported format/)
  })
})

test('GSP credential decryption rejects tampering, truncation, and a different key', async () => {
  const encrypted = await withKey(validKey, () => encryptCredential('sensitive-value'))
  await withKey(validKey, () => {
    const packed = Buffer.from(encrypted.slice(3), 'base64')
    packed[packed.length - 1] ^= 1
    assert.throws(() => decryptCredential('v1:' + packed.toString('base64')), /Unable to decrypt stored GSP credentials/)
    assert.throws(() => decryptCredential('v1:YWJj'), /Unable to decrypt stored GSP credentials/)
  })
  await withKey('b'.repeat(64), () => {
    assert.throws(() => decryptCredential(encrypted), /Unable to decrypt stored GSP credentials/)
  })
})
