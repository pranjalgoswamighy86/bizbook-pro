/**
 * BizBook Pro — EMAIL-ONLY OTP Dispatcher (v4.43)
 * =================================================
 * USER REQUIREMENT (2026-06-20):
 *   - DELETE mobile OTP / 2Factor SMS process entirely
 *   - OTP only via EMAIL for registration + forgot password
 *   - Change password uses old password only (no OTP) — handled in route.ts
 *
 * OLD behavior (REMOVED in v4.43):
 *   - Multi-channel: Email → SMS → WhatsApp
 *   - 2Factor SMS integration
 *   - WhatsApp fail-safe
 *
 * NEW behavior (v4.43):
 *   - Email ONLY (Brevo primary, Resend fallback, SMTP last resort)
 *   - No SMS, no WhatsApp, no 2Factor
 *   - Cleaner, simpler, more reliable
 *
 * Files made obsolete by this change (kept for reference but no longer used):
 *   - src/lib/sms-text.ts (2Factor SMS)
 *   - src/lib/sms.ts (legacy SMS)
 *   - src/lib/whatsapp/meta-cloud.ts (WhatsApp fail-safe)
 */

import { sendOtpEmail, isEmailConfigured } from '@/lib/email';

// ---------- Types ----------
export interface OtpTarget {
  email?: string;
  mobile?: string; // Kept for backward compat — IGNORED in v4.43+
  /** User ID — for audit logging */
  userId?: string;
  /** Tenant ID — for audit logging */
  tenantId?: string;
  /** Purpose tag */
  purpose: 'login' | 'register' | 'reset' | 'workspace_switch';
}

export interface OtpDispatchResult {
  ok: boolean;
  primaryChannel: 'email' | 'none';
  emailDelivered: boolean;
  smsDelivered: boolean; // Always false in v4.43+
  whatsappDelivered: boolean; // Always false in v4.43+
  fallbackReason?: string;
  auditId?: string;
}

// ---------- Constants ----------
const ADMIN_BYPASS_EMAILS = [
  'admin@bizbook.pro',
  (process.env.ADMIN_EMAIL || '').toLowerCase(),
  'pranjalgoswamighy86@gmail.com',
  (process.env.INFRASTRUCTURE_OWNER_EMAIL || '').toLowerCase(),
].filter(Boolean);

// ---------- Main Dispatcher ----------
export async function dispatchOtp(
  otp: string,
  target: OtpTarget
): Promise<OtpDispatchResult> {
  console.log(`[OTP] Dispatching EMAIL-ONLY for ${target.email || 'no-email'} (purpose: ${target.purpose})`);

  // ---------- Pre-flight validation ----------
  if (!target.email) {
    return {
      ok: false,
      primaryChannel: 'none',
      emailDelivered: false,
      smsDelivered: false,
      whatsappDelivered: false,
      fallbackReason: 'NO_EMAIL: email address is required (SMS/WhatsApp removed in v4.43)',
    };
  }

  // ---------- Admin bypass ----------
  if (ADMIN_BYPASS_EMAILS.includes(target.email.toLowerCase())) {
    console.log(`[OTP] Admin bypass — no OTP sent to ${target.email}`);
    return {
      ok: true,
      primaryChannel: 'none',
      emailDelivered: false,
      smsDelivered: false,
      whatsappDelivered: false,
      fallbackReason: 'ADMIN_BYPASS',
    };
  }

  const result: OtpDispatchResult = {
    ok: false,
    primaryChannel: 'none',
    emailDelivered: false,
    smsDelivered: false,
    whatsappDelivered: false,
  };

  // ---------- Track 1 (ONLY track in v4.43): Email ----------
  try {
    console.log(`[OTP] Sending email to ${target.email}`);
    const emailResult = await sendOtpEmail(target.email, otp, undefined);

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
    // v4.43: Skip audit log when tenantId is null (pre-registration OTP).
    // AuditLog.tenantId is non-nullable in schema with required `tenant` relation.
    // During registration, tenant doesn't exist yet, so we have no valid tenantId.
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
          primaryChannel: result.primaryChannel,
          fallbackReason: result.fallbackReason,
          // NEVER log the OTP value itself
        }),
      },
    });
  } catch (err) {
    console.warn('[OTP] Audit log failed (non-blocking):', err);
  }
}
