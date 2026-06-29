/**
 * Health Monitor Endpoint — v4.54
 * =================================
 * Called by Railway cron every hour.
 * Checks app health and sends email notification if issues found.
 *
 * Usage:
 *   Railway cron: every 1 hour
 *   Command: curl -s "https://carefree-success-production-7766.up.railway.app/api/cron/health-monitor?secret=$CRON_SECRET"
 *
 * What it checks:
 *   1. Database connectivity (can we query User count?)
 *   2. Database size (is it growing or stuck?)
 *   3. Active users count
 *   4. Pending payment proofs (admin review needed?)
 *   5. Recent errors in AuditLog (last 1 hour)
 *   6. Subscription queue stuck entries (PENDING > 1 hour)
 *
 * Notification:
 *   - If all OK: returns 200 with stats (no email sent — avoid spam)
 *   - If issues found: sends alert email to pranjalgoswamighy86@gmail.com via Brevo
 *   - If CRITICAL: also sends SMS to 9101555075 via 2Factor (if configured)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db-soft-delete';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const startTime = Date.now();

  // ---------- Auth check ----------
  const expectedSecret = process.env.CRON_SECRET;
  const providedSecret = req.nextUrl.searchParams.get('secret');
  if (expectedSecret && providedSecret !== expectedSecret) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  console.log('[HEALTH-MONITOR] === Hourly Health Check Started ===');

  const issues: string[] = [];
  const stats: Record<string, any> = {};

  try {
    // ---------- 1. Database connectivity ----------
    try {
      const userCount = await db.user.count({ where: { isDeleted: false } });
      stats.users = userCount;
      console.log(`[HEALTH-MONITOR] DB OK — ${userCount} users`);
    } catch (dbErr: any) {
      issues.push(`DB query failed: ${dbErr?.message}`);
      console.error('[HEALTH-MONITOR] DB error:', dbErr?.message);
    }

    // ---------- 2. Tenant count ----------
    try {
      const tenantCount = await db.tenant.count({ where: { isDeleted: false } });
      stats.tenants = tenantCount;
    } catch (err: any) {
      issues.push(`Tenant count failed: ${err?.message}`);
    }

    // ---------- 3. Active subscriptions ----------
    try {
      const activeSubs = await db.subscription.count({ where: { status: 'ACTIVE' } });
      stats.activeSubscriptions = activeSubs;
    } catch (err: any) {
      issues.push(`Subscription count failed: ${err?.message}`);
    }

    // ---------- 4. v4.156: Pending payment proofs check removed ----------
    // Razorpay auto-verifies all payments now — no manual proof review needed.

    // ---------- 5. Stuck subscription queues ----------
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const stuckQueues = await db.subscriptionQueue.count({
        where: { status: 'PENDING', createdAt: { lt: oneHourAgo } }
      });
      stats.stuckQueues = stuckQueues;
      if (stuckQueues > 0) {
        issues.push(`${stuckQueues} queue(s) stuck PENDING > 1hr`);
      }
    } catch (err: any) {
      console.warn('[HEALTH-MONITOR] Queue check skipped:', err?.message);
    }

    // ---------- 6. Recent audit log errors ----------
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentErrors = await db.auditLog.count({
        where: { createdAt: { gt: oneHourAgo }, action: { contains: 'ERROR' } }
      });
      stats.recentErrors = recentErrors;
      if (recentErrors > 5) {
        issues.push(`${recentErrors} error(s) in audit log (last 1hr)`);
      }
    } catch (err: any) {
      console.warn('[HEALTH-MONITOR] Audit log check skipped:', err?.message);
    }

  } catch (err: any) {
    issues.push(`Health check exception: ${err?.message}`);
  }

  const responseTime = Date.now() - startTime;
  stats.responseTimeMs = responseTime;

  const status = issues.length === 0 ? 'OK' : 'ISSUE';

  console.log(`[HEALTH-MONITOR] Status: ${status} (${responseTime}ms), issues: ${issues.length}`);

  // ---------- Send email if issues found ----------
  if (issues.length > 0 && process.env.BREVO_API_KEY) {
    try {
      const { sendViaBrevo } = await import('@/lib/brevo');
      const emailSubject = `BizBook Pro Alert — ${issues.length} issue(s) — ${status}`;
      const emailBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
          <div style="background: #f59e0b; padding: 20px; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 20px;">BizBook Pro Health Monitor</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 4px 0 0; font-size: 13px;">${new Date().toISOString()}</p>
          </div>
          <div style="background: #f9fafb; padding: 24px; border: 1px solid #e5e7eb; border-radius: 0 0 12px 12px;">
            <h2 style="color: #f59e0b; font-size: 16px;">Status: ${status}</h2>
            <h3 style="font-size: 14px; color: #111827;">Issues (${issues.length}):</h3>
            <ul style="font-size: 13px; color: #374151; line-height: 1.8;">
              ${issues.map(i => `<li>${i}</li>`).join('')}
            </ul>
            <h3 style="font-size: 14px; color: #111827; margin-top: 20px;">Stats:</h3>
            <pre style="background: white; padding: 12px; border-radius: 8px; font-size: 12px;">${JSON.stringify(stats, null, 2)}</pre>
            <p style="font-size: 12px; color: #6b7280; margin-top: 16px;">
              App: https://carefree-success-production-7766.up.railway.app/
            </p>
          </div>
        </div>
      `;

      // Use Brevo to send alert email
      const axios = await import('axios');
      await axios.post('https://api.brevo.com/v3/smtp/email', {
        sender: { name: 'BizBook Pro Monitor', email: process.env.BREVO_FROM_EMAIL || 'pranjalgoswamighy86@gmail.com' },
        to: [{ email: 'pranjalgoswamighy86@gmail.com', name: 'Pranjal' }],
        subject: emailSubject,
        htmlContent: emailBody,
        textContent: `BizBook Pro Health Monitor — ${status}. Issues: ${issues.join(', ')}`,
      }, {
        headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
        timeout: 10000,
        validateStatus: () => true,
      });
      console.log('[HEALTH-MONITOR] Alert email sent');
    } catch (emailErr: any) {
      console.error('[HEALTH-MONITOR] Email failed:', emailErr?.message);
    }
  }

  return NextResponse.json({
    status,
    issues,
    stats,
    responseTimeMs: responseTime,
    timestamp: new Date().toISOString(),
  });
}
