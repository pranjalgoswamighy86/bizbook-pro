import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('../scripts/audit-tenant-consolidation.js', import.meta.url), 'utf8')

test('tenant consolidation audit requires explicit isolated database approval', () => {
  assert.match(source, /TENANT_AUDIT_ISOLATED_DB !== 'YES'/)
  assert.match(source, /Refusing to run/)
  assert.match(source, /TENANT_AUDIT_EMAILS/)
})

test('tenant consolidation audit enforces a PostgreSQL read-only transaction', () => {
  assert.match(source, /SET TRANSACTION READ ONLY/)
  assert.match(source, /transaction_read_only/)
  assert.match(source, /database\.read_only !== 'on'/)
})

test('tenant consolidation audit inventories direct tenant rows and foreign-key dependencies', () => {
  assert.match(source, /information_schema\.columns/)
  assert.match(source, /information_schema\.table_constraints/)
  assert.match(source, /foreignKeyDependencyGraph/)
  assert.match(source, /tenantScopedUniqueConstraints/)
})

test('tenant consolidation audit contains no business-data mutation statements', () => {
  assert.doesNotMatch(source, /\.user\.update\(|\.tenant\.update\(|\.userTenant\.update/)
  assert.doesNotMatch(source, /DELETE FROM|UPDATE "Tenant"|UPDATE "User"|INSERT INTO/)
})
