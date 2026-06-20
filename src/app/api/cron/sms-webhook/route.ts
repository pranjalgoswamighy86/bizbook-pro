/**
 * SMS Webhook Endpoint — Zero-Cost SMS-Based Payment Verification
 * =================================================================
 * v4.46: NEW — User receives bank alerts on mobile 9101555075.
 *   Instead of scraping email, this endpoint receives forwarded SMS
 *   from an Android SMS forwarder app installed on the user's phone.
 *
 * HOW IT WORKS:
 *   1. User installs "SMS Forwarder" app on Android phone (the one
 *      receiving bank SMS alerts on 9101555075).
 *   2. App is configured to POST every incoming SMS to this webhook:
 *        POST https://carefree-success-production-7766.up.railway.app/api/cron/sms-webhook?secret=<SMS_WEBHOOK_SECRET>
 *        Body: { "from": "KOTAKBK", "body": "Rs.150.01 credited to a/c... via UPI...", "timestamp": "..." }
 *   3. This endpoint:
 *        - Validates the secret
 *        - Parses the SMS body for ₹X.XX amount
 *        - Matches against pending SubscriptionQueue.finalAmount (UDT)
 *        - On match: activates the subscription in a transaction
 *
 * SECURITY:
 *   - Endpoint protected by SMS_WEBHOOK_SECRET env var (or falls back to CRON_SECRET)
 *   - Validates SMS sender is a known bank sender ID (optional — proceeds with warning)
 *   - Logs every webhook call for audit
 *
 * REQUIRED ENV VARS:
 *   - SMS_WEBHOOK_SECRET  (any random string — set in Railway Variables)
 *     The Android app must include this secret in the URL.
 *
 * ANDROID APP SETUP:
 *   Recommended app: "SMS Forwarder" (F-Droid) or "MacroDroid" (Play Store)
 *   Configuration:
 *     - Trigger: Incoming SMS
 *     - Filter (optional): sender matches KOTAKBK|HDFCBK|SBIBNK|ICICIBK|AXISBK|PNBBNK|YESBNK|baroda
 *     - Action: HTTP POST to webhook URL
 *     - Body template: { "from": "{sender}", "body": "{message}", "timestamp": "{timestamp}" }
 *
 * ALTERNATIVE: Also accepts GET for testing/manual triggers:
 *   GET /api/cron/sms-webhook?secret=X&from=KOTAKBK&sms=Rs.150.01+credited+via+UPI
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db-soft-delete';

export const dynamic = 'force-dynamic';
export const maxDuration = 10; // Quick webhook response

// Indian bank sender IDs (6-char alphanumeric, starts with 2-char bank code)
// Common ones: KOTAKBK, HDFCBK, SBIBNK, ICICIBK, AXISBK, PNBBNK, YESBNK, BOIIND, BARODA
const BANK_SENDER_PATTERNS = [
  /^KOTAK/i, /^HDFC/i, /^SBI/i, /^ICICI/i, /^AXIS/i, /^PNB/i, /^YES/i,
  /^BOI/i, /^BOB/i, /^BARODA/i, /^IDBI/i, /^CANARA/i, /^UNION/i, /^CENTRAL/i,
  /^PAYTM/i, /^PHONEPE/i, /^GPAY/i, /^BHIM/i, /^AMAZON/i,
];

function isBankSender(sender: string): boolean {
  if (!sender) return false;
  return BANK_SENDER_PATTERNS.some(p => p.test(sender));
}

// Regex to extract ₹ amount from SMS body
// Matches: ₹150.01, Rs.150.01, Rs 150.01, INR 150.01, Rs.1,500.01
function extractAmount(text: string): number | null {
  // Try multiple patterns
  const patterns = [
    /(?:Rs\.?|INR|₹)\s?(\d+(?:,\d{3})*\.\d{2})/i,
    /(?:Rs\.?|INR|₹)\s?(\d+\.\d{2})/i,
    /(?:credited|received|deposited)[^\d]*(\d+\.\d{2})/i,
  ];

  for (const p of patterns) {
    const match = text.match(p);
    if (match) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(amount) && amount > 0) return amount;
    }
  }
  return null;
}

async function activateSubscription(session: {
  id: string;
  tenantId: string;
  finalAmount: number;
  planHours: number;
  planName: string;
}, paymentSource: string, paymentRef: string) {
  try {
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

    const sub = await db.subscription.findUnique({ where: { tenantId: session.tenantId } });
    if (sub) {
      await db.recharge.create({
        data: {
          subscriptionId: sub.id,
          planHours: session.planHours,
          planName: session.planName,
          mrp: session.finalAmount,
          discountPercent: 0,
          discountAmount: session.finalAmount,
          totalSeconds: session.planHours * 3600,
          paymentMode: paymentSource,
          paymentRef,
          status: 'COMPLETED',
        },
      });
    }

    console.log(`[SMS-WEBHOOK] ✓ Activated ${session.planHours}h for tenant ${session.tenantId} via ${paymentSource}`);
    return true;
  } catch (err: any) {
    console.error(`[SMS-WEBHOOK] ❌ Activation failed:`, err?.message);
    return false;
  }
}

async function processSmsWebhook(
  secret: string | null,
  smsFrom: string,
  smsBody: string,
  smsTimestamp?: string
) {
  // ---------- Auth check ----------
  const expectedSecret = process.env.SMS_WEBHOOK_SECRET || process.env.CRON_SECRET;
  if (!expectedSecret) {
    console.error('[SMS-WEBHOOK] No SMS_WEBHOOK_SECRET or CRON_SECRET env var set');
    return NextResponse.json(
      { status: 'error', error: 'Webhook secret not configured on server' },
      { status: 500 }
    );
  }
  if (secret !== expectedSecret) {
    console.warn('[SMS-WEBHOOK] Invalid secret provided');
    return NextResponse.json(
      { status: 'error', error: 'Invalid secret' },
      { status: 401 }
    );
  }

  // ---------- Validate SMS body ----------
  if (!smsBody || smsBody.trim().length === 0) {
    return NextResponse.json(
      { status: 'error', error: 'SMS body is required' },
      { status: 400 }
    );
  }

  console.log(`[SMS-WEBHOOK] Received SMS from "${smsFrom}": ${smsBody.substring(0, 100)}...`);

  // ---------- Extract amount ----------
  const amount = extractAmount(smsBody);
  if (amount === null) {
    console.log(`[SMS-WEBHOOK] No amount found in SMS, ignoring`);
    return NextResponse.json({
      status: 'ignored',
      reason: 'no_amount_found',
      message: 'SMS does not contain a recognizable amount',
    });
  }

  console.log(`[SMS-WEBHOOK] Extracted amount: ₹${amount.toFixed(2)}`);

  // ---------- Find pending session matching this amount ----------
  const pendingSessions = await db.subscriptionQueue.findMany({
    where: { status: 'PENDING' },
    select: { id: true, tenantId: true, finalAmount: true, planHours: true, planName: true, createdAt: true },
  });

  if (pendingSessions.length === 0) {
    console.log(`[SMS-WEBHOOK] No pending sessions, ignoring`);
    return NextResponse.json({
      status: 'ignored',
      reason: 'no_pending_sessions',
      amount: amount.toFixed(2),
    });
  }

  // Find session with matching finalAmount (UDT — Unique Decimal Tracking)
  const matched = pendingSessions.find(
    s => Number(s.finalAmount.toFixed(2)) === Number(amount.toFixed(2))
  );

  if (!matched) {
    console.log(`[SMS-WEBHOOK] No pending session matches ₹${amount.toFixed(2)}`);
    return NextResponse.json({
      status: 'ignored',
      reason: 'no_matching_session',
      amount: amount.toFixed(2),
      pendingCount: pendingSessions.length,
      pendingAmounts: pendingSessions.map(s => s.finalAmount.toFixed(2)),
    });
  }

  console.log(`[SMS-WEBHOOK] ✓ MATCH! ₹${amount.toFixed(2)} → tenant ${matched.tenantId}`);

  // ---------- Optional: Validate sender is a known bank ----------
  if (smsFrom && !isBankSender(smsFrom)) {
    console.warn(`[SMS-WEBHOOK] ⚠️ Sender "${smsFrom}" is not a recognized bank — proceeding anyway`);
  }

  // ---------- Activate subscription ----------
  const paymentRef = `SMS_${smsFrom || 'unknown'}_${Date.now()}`;
  const activated = await activateSubscription(
    {
      id: matched.id,
      tenantId: matched.tenantId,
      finalAmount: Number(matched.finalAmount),
      planHours: matched.planHours,
      planName: matched.planName,
    },
    'UPI_AUTO_SMS',
    paymentRef
  );

  if (activated) {
    return NextResponse.json({
      status: 'success',
      matched: true,
      amount: amount.toFixed(2),
      tenantId: matched.tenantId,
      planName: matched.planName,
      planHours: matched.planHours,
      message: `Payment verified via SMS — ${matched.planName} activated!`,
    });
  } else {
    return NextResponse.json(
      { status: 'error', error: 'Activation failed' },
      { status: 500 }
    );
  }
}

// ---------- POST handler (called by Android SMS forwarder app) ----------
export async function POST(req: NextRequest) {
  try {
    const secret = req.nextUrl.searchParams.get('secret');
    const contentType = req.headers.get('content-type') || '';

    let smsFrom = '';
    let smsBody = '';
    let smsTimestamp = '';

    if (contentType.includes('application/json')) {
      const body = await req.json();
      smsFrom = body.from || body.sender || body.phone || '';
      smsBody = body.body || body.message || body.text || body.sms || '';
      smsTimestamp = body.timestamp || body.receivedAt || '';
    } else {
      // Form-encoded or raw body
      const text = await req.text();
      const params = new URLSearchParams(text);
      smsFrom = params.get('from') || params.get('sender') || params.get('phone') || '';
      smsBody = params.get('body') || params.get('message') || params.get('text') || params.get('sms') || text;
      smsTimestamp = params.get('timestamp') || '';
    }

    return await processSmsWebhook(secret, smsFrom, smsBody, smsTimestamp);
  } catch (error: any) {
    console.error('[SMS-WEBHOOK] POST error:', error?.message);
    return NextResponse.json(
      { status: 'error', error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// ---------- GET handler (for manual testing) ----------
// Usage: /api/cron/sms-webhook?secret=X&from=KOTAKBK&sms=Rs.150.01+credited+via+UPI
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  const smsFrom = req.nextUrl.searchParams.get('from') || '';
  const smsBody = req.nextUrl.searchParams.get('sms') || req.nextUrl.searchParams.get('body') || '';
  return await processSmsWebhook(secret, smsFrom, smsBody);
}
