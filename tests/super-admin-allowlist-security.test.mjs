import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const helper = readFileSync('src/lib/system-admin.ts', 'utf8')
const helpRoute = readFileSync('src/app/api/help-tickets/route.ts', 'utf8')
const subscriptionRoute = readFileSync('src/app/api/subscription/route.ts', 'utf8')

test('shared system-admin allowlist parses ADMIN_BYPASS_EMAILS lists', () => {
  assert.ok(helper.includes('process.env.ADMIN_BYPASS_EMAILS'))
  assert.ok(helper.includes('.split(/[ ,;\\s]+/)') || helper.includes('.split(/[,;\\s]+/)'))
  assert.ok(helper.includes('.toLowerCase().trim()'))
})

test('legacy individual admin variables remain supported', () => {
  assert.ok(helper.includes('process.env.ADMIN_EMAIL'))
  assert.ok(helper.includes('process.env.INFRA_OWNER_EMAIL'))
  assert.ok(helper.includes('process.env.INFRASTRUCTURE_OWNER_EMAIL'))
})

test('Help & Support authorization uses the shared server-side allowlist', () => {
  assert.ok(helpRoute.includes('isSystemAdminEmail(user.email)'))
  assert.ok(helpRoute.includes("from '@/lib/system-admin'"))
  assert.ok(!helpRoute.includes('const SUPER_ADMIN_EMAILS'))
})

test('subscription list and modification use the same shared allowlist', () => {
  assert.equal(subscriptionRoute.split('isSystemAdminEmail(access.user?.email)').length - 1, 2)
  assert.ok(subscriptionRoute.includes("from '@/lib/system-admin'"))
  assert.ok(!subscriptionRoute.includes('const SYSTEM_ADMIN_EMAILS'))
})
