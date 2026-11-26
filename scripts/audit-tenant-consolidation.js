#!/usr/bin/env node
/**
 * Read-only tenant consolidation inventory.
 *
 * Run ONLY against a separately restored database copy:
 *   TENANT_AUDIT_ISOLATED_DB=YES \
 *   TENANT_AUDIT_EMAILS="admin@bizbook.pro,PranjalGoswami86@gmail.com" \
 *   node scripts/audit-tenant-consolidation.js
 *
 * This tool performs SELECTs only and starts a PostgreSQL READ ONLY transaction.
 * It does not change tenant, user, membership, accounting, or subscription rows.
 */
'use strict'

const { PrismaClient } = require('@prisma/client')

const emails = String(process.env.TENANT_AUDIT_EMAILS || '')
  .split(',')
  .map(value => value.trim().toLowerCase())
  .filter(Boolean)

if (process.env.TENANT_AUDIT_ISOLATED_DB !== 'YES') {
  console.error('Refusing to run: set TENANT_AUDIT_ISOLATED_DB=YES only for a verified isolated database copy.')
  process.exit(2)
}
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run with NODE_ENV=production. Set NODE_ENV=development for the isolated audit process.')
  process.exit(2)
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required and must point to the isolated database copy.')
  process.exit(2)
}
if (emails.length === 0) {
  console.error('Set TENANT_AUDIT_EMAILS to the two account email addresses to locate their tenant links.')
  process.exit(2)
}

const prisma = new PrismaClient({ log: [] })
const quoteIdentifier = value => '"' + String(value).replace(/"/g, '""') + '"'

async function main() {
  const report = await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')

    const [database] = await tx.$queryRawUnsafe(
      'SELECT current_database() AS database, current_user AS database_user, current_setting(\\'transaction_read_only\\') AS read_only'
    )
    if (database.read_only !== 'on') throw new Error('Database transaction is not read-only; aborting.')

    const placeholders = emails.map((_, index) => '$' + (index + 1)).join(', ')
    const users = await tx.$queryRawUnsafe(
      \`SELECT u.id AS "userId", u.email, u."tenantId" AS "primaryTenantId",
              t.name AS "primaryTenantName", t."isDeleted" AS "primaryTenantDeleted"
         FROM "User" u
         LEFT JOIN "Tenant" t ON t.id = u."tenantId"
        WHERE LOWER(u.email) IN (\${placeholders})
        ORDER BY LOWER(u.email)\`,
      ...emails
    )
    const userIds = users.map(user => user.userId)
    let memberships = []
    if (userIds.length) {
      const userPlaceholders = userIds.map((_, index) => '$' + (index + 1)).join(', ')
      memberships = await tx.$queryRawUnsafe(
        \`SELECT ut."userId", ut."tenantId", ut.role, ut."isOwner",
                t.name AS "tenantName", t."isDeleted" AS "tenantDeleted"
           FROM "UserTenant" ut
           JOIN "Tenant" t ON t.id = ut."tenantId"
          WHERE ut."userId" IN (\${userPlaceholders})
          ORDER BY ut."userId", ut."createdAt"\`,
        ...userIds
      )
    }

    const tenantIds = [...new Set([
      ...users.map(user => user.primaryTenantId),
      ...memberships.map(item => item.tenantId),
    ].filter(Boolean))]
    const tenantPlaceholders = tenantIds.map((_, index) => '$' + (index + 1)).join(', ')
    const tenantCounts = []
    if (tenantIds.length) {
      const tables = await tx.$queryRawUnsafe(
        \`SELECT DISTINCT table_name AS "tableName"
           FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'tenantId'
          ORDER BY table_name\`
      )
      for (const { tableName } of tables) {
        // Table names originate from information_schema and are quoted as identifiers.
        const query = \`SELECT \${quoteIdentifier('tenantId')} AS "tenantId", COUNT(*)::text AS "rowCount"
                         FROM \${quoteIdentifier(tableName)}
                        WHERE \${quoteIdentifier('tenantId')} IN (\${tenantPlaceholders})
                        GROUP BY \${quoteIdentifier('tenantId')}\`
        const rows = await tx.$queryRawUnsafe(query, ...tenantIds)
        for (const row of rows) tenantCounts.push({ tableName, ...row })
      }
    }

    const foreignKeys = await tx.$queryRawUnsafe(
      \`SELECT tc.table_name AS "childTable", kcu.column_name AS "childColumn",
              ccu.table_name AS "parentTable", ccu.column_name AS "parentColumn",
              tc.constraint_name AS "constraintName"
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
        ORDER BY tc.table_name, tc.constraint_name\`
    )

    const tenantUniqueConstraints = await tx.$queryRawUnsafe(
      \`SELECT tc.table_name AS "tableName", tc.constraint_name AS "constraintName",
              string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public'
        GROUP BY tc.table_name, tc.constraint_name
       HAVING bool_or(kcu.column_name = 'tenantId')
        ORDER BY tc.table_name, tc.constraint_name\`
    )

    const tenantRows = tenantIds.length
      ? await tx.$queryRawUnsafe(
          \`SELECT id, name, "isDeleted", "createdAt"
             FROM "Tenant" WHERE id IN (\${tenantPlaceholders}) ORDER BY id\`,
          ...tenantIds
        )
      : []

    return {
      database: { name: database.database, readOnly: database.read_only },
      inspectedEmails: emails,
      users,
      memberships,
      candidateTenants: tenantRows,
      tenantScopedRowCounts: tenantCounts,
      tenantScopedUniqueConstraints: tenantUniqueConstraints,
      foreignKeyDependencyGraph: foreignKeys,
      notes: [
        'Only tables with a direct tenantId column are counted in tenantScopedRowCounts.',
        'foreignKeyDependencyGraph identifies indirect child tables that need separate ID/link checks.',
        'Unique constraints are inventoried, not automatically resolved.',
        'No tenant or user rows were modified.',
      ],
    }
  }, { timeout: 120000 })

  console.log(JSON.stringify(report, null, 2))
}

main()
  .catch(error => {
    console.error('Tenant audit failed:', error.message)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
