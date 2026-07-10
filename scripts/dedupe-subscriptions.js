/**
 * v6.24.0: One-Time Subscription Dedup Script
 * ============================================
 *
 * Resolves the recurring auto-repair message:
 *   [AUTO-REPAIR] Consolidated 2 subscriptions for user cmqotr1fm0007qr01g210q22h
 *
 * ROOT CAUSE:
 *   Before the v6.23.0 upsert fix, the subscription create() code could
 *   create duplicate subscription rows for the same tenantId (race condition).
 *   The auto-repair script consolidated them on every startup, but the
 *   duplicate row was never deleted — so it kept re-appearing.
 *
 * WHAT THIS SCRIPT DOES:
 *   1. Finds all tenants with more than 1 subscription row
 *   2. For each duplicate set:
 *      a. Sums the remainingSeconds across all duplicates
 *      b. Updates the OLDEST subscription with the summed balance
 *      c. Transfers all Recharge and UsageLog records to the oldest subscription
 *      d. Deletes the newer duplicate rows
 *   3. Reports what was fixed
 *
 * This script is SAFE to run multiple times — if there are no duplicates,
 * it does nothing.
 *
 * Usage:
 *   node scripts/dedupe-subscriptions.js
 *
 * Or via Railway Console:
 *   node scripts/dedupe-subscriptions.js
 */

const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });

  console.log('[DEDUP] Starting subscription deduplication...');

  try {
    // Step 1: Find all tenants with more than 1 subscription
    const duplicates = await prisma.$queryRaw`
      SELECT "tenantId", COUNT(*)::int as count
      FROM "Subscription"
      WHERE "isDeleted" = false OR "isDeleted" IS NULL
      GROUP BY "tenantId"
      HAVING COUNT(*) > 1
    `;

    if (!duplicates || duplicates.length === 0) {
      console.log('[DEDUP] ✅ No duplicate subscriptions found — nothing to fix.');
      return;
    }

    console.log(`[DEDUP] Found ${duplicates.length} tenant(s) with duplicate subscriptions:`);

    let totalFixed = 0;

    for (const dup of duplicates) {
      const tenantId = dup.tenantId;
      console.log(`[DEDUP] Processing tenant ${tenantId} (${dup.count} subscriptions)...`);

      // Get all subscriptions for this tenant, ordered by creation (oldest first)
      const subs = await prisma.subscription.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
        include: { recharges: true },
      });

      if (subs.length < 2) continue;

      const keepSub = subs[0]; // Oldest — this is the one we keep
      const dupSubs = subs.slice(1); // Newer ones — these get deleted

      // Sum remainingSeconds across all duplicates
      const totalRemaining = subs.reduce((sum, s) => sum + (s.remainingSeconds || 0), 0);

      console.log(`[DEDUP]   Keeping subscription ${keepSub.id} (created ${keepSub.createdAt.toISOString()})`);
      console.log(`[DEDUP]   Summing wallet: ${subs.map(s => s.remainingSeconds).join(' + ')} = ${totalRemaining}s`);

      // Update the oldest subscription with the summed balance
      await prisma.subscription.update({
        where: { id: keepSub.id },
        data: { remainingSeconds: totalRemaining },
      });

      // Transfer all Recharge records from duplicates to the kept subscription
      for (const dupSub of dupSubs) {
        // Move recharges
        const rechargesMoved = await prisma.recharge.updateMany({
          where: { subscriptionId: dupSub.id },
          data: { subscriptionId: keepSub.id },
        });
        if (rechargesMoved.count > 0) {
          console.log(`[DEDUP]   Moved ${rechargesMoved.count} recharge(s) from ${dupSub.id} to ${keepSub.id}`);
        }

        // Move usage logs (if they reference subscriptionId)
        try {
          const usageMoved = await prisma.usageLog.updateMany({
            where: { subscriptionId: dupSub.id },
            data: { subscriptionId: keepSub.id },
          });
          if (usageMoved.count > 0) {
            console.log(`[DEDUP]   Moved ${usageMoved.count} usage log(s) from ${dupSub.id} to ${keepSub.id}`);
          }
        } catch (e) {
          // UsageLog may not have subscriptionId field — skip silently
        }

        // Delete the duplicate subscription
        await prisma.subscription.delete({
          where: { id: dupSub.id },
        });
        console.log(`[DEDUP]   ✅ Deleted duplicate subscription ${dupSub.id}`);
      }

      console.log(`[DEDUP]   ✅ Tenant ${tenantId}: kept 1 subscription with ${totalRemaining}s wallet`);
      totalFixed++;
    }

    console.log(`[DEDUP] ✅ Complete. Fixed ${totalFixed} tenant(s).`);

    // Verify: no more duplicates
    const remainingDups = await prisma.$queryRaw`
      SELECT "tenantId", COUNT(*)::int as count
      FROM "Subscription"
      GROUP BY "tenantId"
      HAVING COUNT(*) > 1
    `;
    if (!remainingDups || remainingDups.length === 0) {
      console.log('[DEDUP] ✅ Verification passed: 0 duplicate subscriptions remaining.');
    } else {
      console.log(`[DEDUP] ⚠️ Verification found ${remainingDups.length} remaining duplicate(s) — investigate.`);
    }

  } catch (err) {
    console.error('[DEDUP] ❌ Error:', err.message);
    console.error('[DEDUP] Stack:', err.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('[DEDUP] Fatal:', err);
  process.exit(1);
});
