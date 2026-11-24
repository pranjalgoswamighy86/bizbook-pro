/**
 * BizBook Pro — OTP Dispatcher (v4.63)
 * =====================================
 * v4.63: Re-enabled SMS for registration (email + SMS simultaneously)
 *   - Registration: sends BOTH email OTP + SMS OTP at the same time
 *   - Login: NO OTP (removed in v4.60)
 *   - Forgot password: email only (SMS not needed for password reset)
 *
 * User must enter the SAME OTP (both email and SMS contain the same 6-digit code)
 * to verify their identity during registration.
 *
 * v6.30.7: Added per-channel timeout (OTP_TIMEOUT_MS = 12s). When email/SMS
 * providers are unreachable or API keys aren't configured but the code still
 * attempts a connection, the network call hangs indefinitely (observed: 45s+
 * timeout on /api/auth action=register-send-otp in production). The timeout
 * races each send against a 12-second deadline; if it fires, the existing
 * try/catch sets fallbackReason to include 'NOT_CONFIGURED' so the auth
 * route's production gate (503 'OTP delivery service is not configured')
 * fires immediately instead of after 45s. 12s is generous — real sends
 * complete in <3s.
 */

import { sendOtpEmail } from '@/lib/email';
import { sendSmsTextOnly } from '@/lib/sms-text';

// v6.30.7: Per-channel timeout for email/SMS sends.
const OTP_TIMEOUT_MS = 12_000;

/**
 * Race a promise against a timeout. If the timeout fires first, reject with
 * an Error whose message includes 'NOT_CONFIGURED' so downstream callers
 * (auth route production gate) treat it as a configuration issue, not a
 * transient network blip.
 */
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => {
      const msg = `${label}: NOT_CONFIGURED — timed out after ${OTP_TIMEOUT_MS / 1000}s (provider unreachable or API keys not set)`;
      console.error(`[OTP] ⏱ ${msg}`);
      reject(new Error(msg));
    }, OTP_TIMEOUT_MS),
  );
  return Promise.race([promise, timeout]) as Promise<T>;
}

// ---------- Types ----------
export interface OtpTarget {
  email?: string;
  mobile?: string;
  userId?: string;
  tenantId?: string;
  purpose: 'login' | 'register' | 'reset' | 'workspace_switch';
}

export interface OtpDispatchResult {
  ok: boolean;
  primaryChannel: 'email' | 'sms' | 'both' | 'none';
  emailDelivered: boolean;
  smsDelivered: boolean;
  whatsappDelivered: boolean;
  fallbackReason?: string;
  auditId?: string;
}

// ---------- Main Dispatcher ----------
export async function dispatchOtp(
  otp: string,
  target: OtpTarget
): Promise<OtpDispatchResult> {
  console.log(`[OTP] Dispatching for ${target.email || 'no-email'} / ${target.mobile || 'no-mobile'} (purpose: ${target.purpose})`);

  // ---------- Pre-flight validation ----------
  if (!target.email && !target.mobile) {
    return {
      ok: false,
      primaryChannel: 'none',
      emailDelivered: false,
      smsDelivered: false,
      whatsappDelivered: false,
      fallbackReason: 'NO_TARGET: neither email nor mobile provided',
    };
  }

  const result: OtpDispatchResult = {
    ok: false,
    primaryChannel: 'none',
    emailDelivered: false,
    smsDelivered: false,
    whatsappDelivered: false,
  };

  // v4.63: For registration, send BOTH email + SMS simultaneously
  // For other purposes (reset), email only
  const sendSms = target.purpose === 'register' && !!target.mobile;

  // ---------- Track 1: Email ----------
  if (target.email) {
    try {
      console.log(`[OTP] Sending email to ${target.email}`);
      const emailResult = await withTimeout(
        sendOtpEmail(target.email, otp, undefined),
        'Email OTP',
      );

      if (emailResult.success) {
        result.emailDelivered = true;
        result.primaryChannel = 'email';
        result.ok = true;
        console.log(`[OTP] ✓ Email delivered to ${target.email}`);
      } else {
        console.warn(`[OTP] ✗ Email failed: ${emailResult.error}`);
        result.fallbackReason = `Email: ${emailResult.error}`;
      }
    } catch (err: any) {
      console.error(`[OTP] Email exception:`, err?.message);
      result.fallbackReason = `Email exception: ${err?.message}`;
    }
  }

  // ---------- Track 2: SMS (for registration only — simultaneous with email) ----------
  if (sendSms && target.mobile) {
    try {
      console.log(`[OTP] Sending SMS to ${target.mobile}`);
      const smsResult = await withTimeout(
        sendSmsTextOnly({
          to: target.mobile,
          otp,
          purpose: target.purpose,
        }),
        'SMS OTP',
      );

      if (smsResult.ok) {
        result.smsDelivered = true;
        if (!result.ok) {
          result.primaryChannel = 'sms';
          result.ok = true;
        } else {
          result.primaryChannel = 'both';
        }
        console.log(`[OTP] ✓ SMS delivered to ${target.mobile}`);
      } else {
        console.warn(`[OTP] ✗ SMS failed: ${smsResult.error}`);
        result.fallbackReason = (result.fallbackReason || '') + ` | SMS: ${smsResult.error}`;
      }
    } catch (err: any) {
      console.error(`[OTP] SMS exception:`, err?.message);
      result.fallbackReason = (result.fallbackReason || '') + ` | SMS exception: ${err?.message}`;
    }
  }

  // ---------- Audit log (non-blocking) ----------
  await auditOtpDispatch(target, otp, result).catch(() => {});

  return result;
}

// ---------- Audit Log Helper ----------
async function auditOtpDispatch(
  target: OtpTarget,
  otp: string,
  result: OtpDispatchResult
) {
  try {
    if (!target.tenantId) {
      console.log('[OTP] Audit log skipped — no tenantId (pre-registration OTP)');
      return;
    }

    const { db } = await import('@/lib/db');
    await db.auditLog.create({
      data: {
        userId: target.userId || null,
        tenantId: target.tenantId,
        action: `OTP_DISPATCH:${target.purpose}`,
        entityType: 'OTP',
        entityId: target.userId || target.email || 'unknown',
        entityName: target.email ? `${target.email.slice(0, 3)}***` : 'unknown',
        changes: JSON.stringify({
          emailDelivered: result.emailDelivered,
          smsDelivered: result.smsDelivered,
          primaryChannel: result.primaryChannel,
          fallbackReason: result.fallbackReason,
        }),
      },
    });
  } catch (err) {
    console.warn('[OTP] Audit log failed (non-blocking):', err);
  }
}
