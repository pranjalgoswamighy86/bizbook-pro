import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('session tokens carry a version and both token types support version binding', () => {
  const auth = readFileSync('src/lib/auth.ts', 'utf8')
  assert.match(auth, /sessionVersion: number/)
  assert.match(auth, /createSessionToken\(userId: string, email: string, sessionVersion = 0\)/)
  assert.match(auth, /createPreWorkspaceToken\(userId: string, email: string, sessionVersion = 0\)/)
  assert.match(auth, /payload: SessionPayload = \{ userId, email, expiresAt, sessionVersion \}/)
})

test('requireAuth rejects tokens whose session version is stale', () => {
  const helpers = readFileSync('src/lib/api-helpers.ts', 'utf8')
  assert.match(helpers, /sessionVersion: true/)
  assert.match(helpers, /\(payload\.sessionVersion \?\? 0\) !== user\.sessionVersion/)
  assert.match(helpers, /Session revoked\. Please log in again\./)
})

test('password reset and change increment session version; issued tokens bind to user version', () => {
  const route = readFileSync('src/app/api/auth/route.ts', 'utf8')
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  assert.match(schema, /sessionVersion\s+Int\s+@default\(0\)/)
  assert.equal((route.match(/sessionVersion: \{ increment: 1 \}/g) || []).length, 2)
  assert.match(route, /createSessionToken\(user\.id, user\.email, user\.sessionVersion \?\? 0\)/)
  assert.match(route, /createPreWorkspaceToken\(user\.id, user\.email, user\.sessionVersion \?\? 0\)/)
  assert.match(route, /createSessionToken\(userTenant\.user\.id, userTenant\.user\.email, userTenant\.user\.sessionVersion \?\? 0\)/)
  assert.doesNotMatch(route, /createSessionToken\(user\.id, user\.email\)/)
})
