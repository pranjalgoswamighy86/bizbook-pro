import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const readRoute = (path) => readFileSync(path, 'utf8')

test('AI smart search uses soft-delete extended Prisma client', () => {
  const route = readRoute('src/app/api/ai-smart-search/route.ts')
  assert.match(route, /from ['"]@\/lib\/db-soft-delete['"]/)
  assert.doesNotMatch(route, /from ['"]@\/lib\/db['"]/)
})

test('help chat uses findFirst with explicit tenant soft-delete guard', () => {
  const route = readRoute('src/app/api/help-chat/route.ts')
  assert.match(route, /from ['"]@\/lib\/db-soft-delete['"]/)
  assert.match(route, /db\.tenant\.findFirst\(/)
  assert.match(route, /where: \{ id: auth\.tenantId, isDeleted: false \}/)
  assert.doesNotMatch(route, /db\.tenant\.findUnique\(/)
})

test('AI valuation route is implemented and uses soft-delete client and auth tenant scope', () => {
  const route = readRoute('src/app/api/ai-valuation/route.ts')
  assert.match(route, /from ['"]@\/lib\/db-soft-delete['"]/)
  assert.match(route, /auth\.tenantId/)
  assert.match(route, /aggregateFinancialYears/)
  assert.match(route, /calculateValuation/)
  assert.match(route, /success: true/)
  assert.match(route, /distinct: \['bankName', 'accountNumber'\]/)
  assert.match(route, /const cash = bankCash/)
  assert.match(route, /select: \{ amount: true \}/)
  assert.doesNotMatch(route, /No search query provided/)
})
