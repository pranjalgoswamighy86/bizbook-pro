import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('restore always skips portable User records and reports them as skipped', () => {
  const route = readFileSync('src/app/api/backup/restore/route.ts', 'utf8')
  const guard = route.indexOf("if (model === 'user') {")
  assert.notEqual(guard, -1)
  const guardBlock = route.slice(guard, route.indexOf("if (tenantId && model === 'tenant')", guard))
  assert.match(guardBlock, /const skipped = sourceRows\.length/)
  assert.match(guardBlock, /totalSkipped \+= skipped/)
  assert.match(guardBlock, /results\.push\(\{ table: label, imported: 0, updated: 0, skipped \}\)/)
  assert.match(guardBlock, /continue/)
  assert.ok(guard < route.indexOf('const delegate = (rawDb as any)[model]'))
})

test('portable restores skip memberships and user-linked support tickets', () => {
  const route = readFileSync('src/app/api/backup/restore/route.ts', 'utf8')
  const guard = route.indexOf("if (model === 'userTenant' || model === 'helpSupportTicket') {")
  assert.notEqual(guard, -1)
  const guardBlock = route.slice(guard, route.indexOf("if (tenantId && model === 'tenant')", guard))
  assert.match(guardBlock, /const skipped = sourceRows\\.length/)
  assert.match(guardBlock, /totalSkipped \\+= skipped/)
  assert.match(guardBlock, /results\\.push\\(\\{ table: label, imported: 0, updated: 0, skipped \\}\\)/)
  assert.match(guardBlock, /continue/)
  assert.ok(guard < route.indexOf('const delegate = (rawDb as any)[model]'))
})
