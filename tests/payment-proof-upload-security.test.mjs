import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('payment proof upload validates declared type and file signature', () => {
  const source = readFileSync('src/app/api/payment-proof/route.ts', 'utf8')
  assert.match(source, /!ALLOWED_EXTENSIONS\.includes\(ext\) \|\| !MIME_BY_EXTENSION\[ext\]\?\.includes\(mimeType\)/)
  assert.match(source, /hasValidFileSignature\(buffer, ext\)/)
  assert.match(source, /buffer\.toString\('ascii', 8, 12\) === 'WEBP'/)
  assert.match(source, /buffer\.toString\('ascii', 0, 5\) === '%PDF-'/)
})

test('payment proof submission only transitions active pending queue entries once', () => {
  const source = readFileSync('src/app/api/payment-proof/route.ts', 'utf8')
  assert.match(source, /status: 'PENDING',[\s\S]*?tenant: \{ isDeleted: false \}/)
  assert.match(source, /if \(submitted\.count !== 1\)/)
  assert.match(source, /tenant: \{ isDeleted: false \}/)
})

test('payment proof downloads are not cached by browsers or intermediaries', () => {
  const source = readFileSync('src/app/api/payment-proof/route.ts', 'utf8')
  assert.match(source, /'Cache-Control': 'private, no-store'/)
})
