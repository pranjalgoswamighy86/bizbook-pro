/**
 * Read-only inventory for the Tahigo International tenant merge.
 *
 * Run from the repository root in an environment with DATABASE_URL:
 *   node scripts/audit-tahigo-tenant-merge.js
 *
 * This script performs SELECT/count operations only. It does not update,
 * delete, merge, reassign, or create any records.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const TARGET_EMAILS = [
  'admin@bizbook.pro',
  'pranjalgoswami86@gmail.com',
];

async function main() {
  const tenants = await prisma.tenant.findMany({
    where: {
      name: { contains: 'Tahigo International', mode: 'insensitive' },
    },
    select: {
      id: true,
      name: true,
      email: true,
      gstNumber: true,
      panNumber: true,
      isDeleted: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const users = await prisma.user.findMany({
    where: { email: { in: TARGET_EMAILS, mode: 'insensitive' } },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      tenantId: true,
      isActive: true,
      isDeleted: true,
      userTenants: {
        select: {
          id: true,
          tenantId: true,
          role: true,
          isOwner: true,
        },
      },
    },
  });

  const modelMetadata = Object.values(prisma._runtimeDataModel.models);
  const countsByTenant = {};

  for (const tenant of tenants) {
    const counts = {};
    for (const model of modelMetadata) {
      if (!model.fields.some((field) => field.name === 'tenantId')) continue;
      const delegateName = model.name.charAt(0).toLowerCase() + model.name.slice(1);
      const delegate = prisma[delegateName];
      if (!delegate || typeof delegate.count !== 'function') continue;
      try {
        counts[model.name] = await delegate.count({
          where: { tenantId: tenant.id },
        });
      } catch (error) {
        counts[model.name] = { error: error.message };
      }
    }
    countsByTenant[tenant.id] = counts;
  }

  const result = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    targetEmails: TARGET_EMAILS,
    tenants,
    users,
    countsByTenant,
    warnings: [
      'Counts include soft-deleted rows unless the model has no such rows.',
      'This inventory counts direct tenantId ownership; dependent rows linked only through parent IDs require a second FK-graph audit.',
      'No tenant or business data was changed.',
    ],
  };

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main()
  .catch((error) => {
    console.error('[TAHIGO-MERGE-AUDIT] Failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
