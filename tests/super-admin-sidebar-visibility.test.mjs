import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('sidebar resolves Super Admin navigation from server authorization', () => {
  const source = readFileSync('src/components/app/sidebar.tsx', 'utf8')
  assert.match(source, /authFetch\('\/api\/help-tickets'/)
  assert.match(source, /JSON\.stringify\(\{ action: 'access' \}\)/)
  assert.match(source, /setIsSuperAdmin\(allowed\)/)
  assert.match(source, /if \(item\.minRole === 'SUPER_ADMIN'\)[\s\S]*?return isSuperAdmin/)
})
