import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(path, 'utf8')

test('portable backups exclude user password hashes and password-reset OTP records', () => {
  const backup = read('src/lib/backup-utils.ts')
  assert.match(backup, /function sanitizeBackupRows\(model: string, rows: any\[\]\)/)
  assert.match(backup, /model !== 'user'\) return rows/)
  assert.match(backup, /password: _password, \.\.\.safeUser/)
  assert.match(backup, /sanitizeBackupRows\(table\.model, rows\)/)
  assert.doesNotMatch(backup, /model: 'passwordReset'/)
})

test('restore removes password field before any database upsert', () => {
  const restore = read('src/app/api/backup/restore/route.ts')
  assert.match(restore, /delete cleaned\.password/)
  assert.match(restore, /const nextRecord = cleanRecord\(record\)/)
  assert.match(restore, /delegate\.upsert\(/)
  assert.ok(restore.indexOf('const nextRecord = cleanRecord(record)') < restore.indexOf('delegate.upsert('))
})

test('backup download enforces platform identity or tenant admin membership', () => {
  const route = read('src/app/api/backup/download/route.ts')
  assert.match(route, /isSuperAdminEmail\(auth\.email\) && auth\.user\.role === 'SUPER_ADMIN'/)
  assert.match(route, /isInfrastructureOwnerEmail\(auth\.email\) && auth\.user\.role === 'INFRASTRUCTURE_OWNER_ADMIN'/)
  assert.match(route, /rawDb\.userTenant\.findFirst/)
  assert.match(route, /membership\.role !== 'MAIN_ADMIN' && !membership\.isOwner/)
})

test('invoice uploads and downloads require tenant authorization and private caching', () => {
  const upload = read('src/app/api/save-invoice-file/route.ts')
  const download = read('src/app/api/invoice-file/route.ts')
  assert.match(upload, /requireAuthAndTenant\(req, body\.tenantId\)/)
  assert.match(upload, /MAX_FILE_BYTES = 10 \* 1024 \* 1024/)
  assert.match(upload, /hasExpectedFileSignature/)
  assert.match(download, /requireAuthAndTenant\(req, tenantId\)/)
  assert.match(download, /rawDb\.sale\.findFirst/)
  assert.match(download, /rawDb\.purchase\.findFirst/)
  assert.match(download, /Cache-Control':?\s*'private, no-store, max-age=0'/)
  assert.doesNotMatch(download, /Cache-Control':?\s*'public/)
})
