/**
 * IMAP Scraper Cron Endpoint — Spec Section 17 + 22
 * ================================================
 * Zero-Cost Autonomous UPI Payment Automation
 *
 * Workflow:
 *   1. Connect to admin's bank-alert Gmail via IMAP
 *   2. Search for UNSEEN messages
 *   3. Parse currency amounts (₹/Rs./INR + decimal)
 *   4. Match against pending SubscriptionQueue.finalAmount (UDT)
 *   5. On match: activate tenant's plan + mark queue as SUCCESS
 *
 * SECURITY: This endpoint is protected by CRON_SECRET env var.
 *           Set CRON_SECRET in Railway Variables.
 *           Railway cron calls: /api/cron/imap-scan?secret=<CRON_SECRET>
 *
 * REQUIRED ENV VARS:
 *   - AUTO_ALERT_EMAIL_USER      (admin bank-alert Gmail)
 *   - AUTO_ALERT_EMAIL_PASSWORD  (Gmail App Password — 16 chars)
 *   - CRON_SECRET                (shared secret for endpoint auth)
 *
 * RAILWAY CRON CONFIG (railway.json or dashboard):
 *   schedule: every 2 minutes (cron expression: star-slash-2 space star space star space star space star)
 *   command: curl -s https://carefree-success-production-7766.up.railway.app/api/cron/imap-scan?secret=$CRON_SECRET
 *
 * SELF-DISABLES: If env vars missing, returns 200 OK with status: "disabled"
 *                (so cron doesn't spam error logs)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db-soft-delete';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // Railway cron max 30s

export async function GET(req: NextRequest) {
  // ---------- Auth check ----------
  const expectedSecret = process.env.CRON_SECRET;
  const providedSecret = req.nextUrl.searchParams.get('secret');

  if (expectedSecret && providedSecret !== expectedSecret) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  // ---------- Self-disable if not configured ----------
  const emailUser = process.env.AUTO_ALERT_EMAIL_USER;
  const emailPass = process.env.AUTO_ALERT_EMAIL_PASSWORD;

  if (!emailUser || !emailPass) {
    return NextResponse.json({
      status: 'disabled',
      reason: 'AUTO_ALERT_EMAIL_USER or AUTO_ALERT_EMAIL_PASSWORD not set',
      message: 'IMAP scraper skipped — configure env vars to enable autonomous UPI verification',
    });
  }

  // ---------- Dynamic import to avoid bundling imap when not used ----------
  let Imap: any;
  let simpleParser: any;
  try {
    const imapModule = await import('imap');
    Imap = imapModule.default || imapModule;
    const parserModule = await import('mailparser');
    simpleParser = parserModule.simpleParser;
  } catch (err: any) {
    return NextResponse.json({
      status: 'disabled',
      reason: 'imap or mailparser package not installed',
      message: 'Run: npm install imap mailparser',
    });
  }

  // ---------- Find pending sessions for matching ----------
  const pendingSessions = await db.subscriptionQueue.findMany({
    where: { status: 'PENDING' },
    select: { id: true, tenantId: true, finalAmount: true, planHours: true, planName: true },
  });

  if (pendingSessions.length === 0) {
    return NextResponse.json({
      status: 'no_pending',
      message: 'No pending UPI checkout sessions to verify',
    });
  }

  // Build lookup map: finalAmount → session
  const amountMap = new Map<number, typeof pendingSessions[0]>();
  pendingSessions.forEach((s) => {
    amountMap.set(Number(s.finalAmount.toFixed(2)), s);
  });

  console.log(`[IMAP-SCRAPER] Checking inbox for ${pendingSessions.length} pending session(s)`);

  // ---------- IMAP connection ----------
  return new Promise<NextResponse>((resolve) => {
    const imap = new Imap({
      user: emailUser,
      password: emailPass,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 10000,
      authTimeout: 10000,
    });

    let matchedCount = 0;
    let scannedCount = 0;
    const errors: string[] = [];

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err: any) => {
        if (err) {
          errors.push(`openBox failed: ${err.message}`);
          imap.end();
          resolve(NextResponse.json({ status: 'error', errors }, { status: 500 }));
          return;
        }

        // Search for unread messages from last 24h
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        imap.search(['UNSEEN', ['SINCE', since]], async (err: any, results: number[]) => {
          if (err || !results || results.length === 0) {
            console.log('[IMAP-SCRAPER] No unread messages');
            imap.end();
            resolve(NextResponse.json({
              status: 'success',
              scanned: 0,
              matched: 0,
              pending: pendingSessions.length,
            }));
            return;
          }

          console.log(`[IMAP-SCRAPER] Found ${results.length} unread message(s)`);

          const fetchStream = imap.fetch(results, { bodies: '' });
          const messagePromises: Promise<void>[] = [];

          fetchStream.on('message', (msg: any) => {
            const promise = new Promise<void>((resolveMsg) => {
              msg.on('body', (stream: any) => {
                const chunks: Buffer[] = [];
                stream.on('data', (chunk: Buffer) => chunks.push(chunk));
                stream.on('end', async () => {
                  try {
                    const parsed = await simpleParser(Buffer.concat(chunks));
                    scannedCount++;
                    const body = parsed.text || parsed.html || '';

                    // Regex: match ₹499.18, Rs.499.18, INR 499.18
                    const amountRegex = /(?:Rs\.?|INR|₹)\s?(\d+\.\d{2})/i;
                    const match = body.match(amountRegex);

                    if (match) {
                      const amount = parseFloat(match[1]);
                      const session = amountMap.get(amount);

                      if (session) {
                        console.log(`[IMAP-SCRAPER] ✓ MATCH! ₹${amount} → tenant ${session.tenantId}`);
                        matchedCount++;

                        // Atomic transaction: mark queue SUCCESS + activate tenant subscription
                        await db.$transaction([
                          db.subscriptionQueue.update({
                            where: { id: session.id },
                            data: {
                              status: 'SUCCESS',
                              completedAt: new Date(),
                            },
                          }),
                          db.subscription.upsert({
                            where: { tenantId: session.tenantId },
                            update: {
                              planName: session.planName,
                              planHours: session.planHours,
                              remainingSeconds: { increment: session.planHours * 3600 },
                              totalSeconds: { increment: session.planHours * 3600 },
                              status: 'ACTIVE',
                              isFreeTier: false,
                              endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                            },
                            create: {
                              tenantId: session.tenantId,
                              planName: session.planName,
                              planHours: session.planHours,
                              remainingSeconds: session.planHours * 3600,
                              totalSeconds: session.planHours * 3600,
                              status: 'ACTIVE',
                              isFreeTier: false,
                              endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                            },
                          }),
                        ]);

                        console.log(`[IMAP-SCRAPER] ✓ Activated ${session.planHours}h for tenant ${session.tenantId}`);
                      }
                    }
                  } catch (parseErr: any) {
                    errors.push(`parse error: ${parseErr.message}`);
                  }
                  resolveMsg();
                });
              });
            });
            messagePromises.push(promise);
          });

          fetchStream.once('end', async () => {
            await Promise.all(messagePromises);
            console.log(`[IMAP-SCRAPER] Scan complete — scanned: ${scannedCount}, matched: ${matchedCount}`);
            imap.end();
            resolve(NextResponse.json({
              status: 'success',
              scanned: scannedCount,
              matched: matchedCount,
              pending: pendingSessions.length,
              errors: errors.length > 0 ? errors : undefined,
            }));
          });
        });
      });
    });

    imap.once('error', (err: any) => {
      console.error('[IMAP-SCRAPER] IMAP error:', err.message);
      resolve(NextResponse.json({
        status: 'error',
        error: err.message,
        errors,
      }, { status: 500 }));
    });

    imap.once('end', () => {
      console.log('[IMAP-SCRAPER] Connection ended');
    });

    imap.connect();
  });
}
