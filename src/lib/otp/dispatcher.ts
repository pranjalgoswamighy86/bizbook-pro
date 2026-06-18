/**
 * BizBook Pro — Multi-Channel OTP Dispatcher
 * -------------------------------------------
 * FIXES (per Spec Part 3 + Rule 1.1 + Rule 2.1):
 *
 *   1. CRITICAL: NEVER route OTP to master mobile (9101555075)
 *      - The bug: existing code falls back to process.env.MASTER_MOBILE_NUMBER
 *      - The fix: bind `to:` strictly to userProfile.email / userProfile.mobile
 *      - Master mobile is ONLY for Super Admin's own logins (admin@bizbook.pro)
 *
 *   2. CRITICAL: NO voice calls / TTS
 *      - Spec Rule 2.1 mandates text-only SMS
 *      - 2Factor's voice fallback must be disabled in dashboard (owner action)
 *      - This code calls /v1/SMSOTP (text) — NOT /v1/VOICEOTP or /v1/CALLS
 *
 *   3. Multi-channel waterfall:
 *      Track 1: Email (Resend primary, SMTP fallback)
 *      Track 2: SMS text (only if email fails OR ENFORCE_DUAL_AUTH=true)
 *      Track 3: WhatsApp text (only if SMS fails AND WHATSAPP_ACCESS_TOKEN set)
 *
 *   4. Absolute isolation: per spec, kdhomesghy@gmail.com / goswamipranjalghy86@gmail.com
 *      receive OTPs ONLY at their registered email/mobile — never at master.
 *
 * PLACE AT: lib/otp/dispatcher.ts
 */

// Use the repo's existing email.ts (already Resend-first) — has sendOtpEmail()
import { sendOtpEmail, isEmailConfigured } from '@/lib/email';
import { sendSmsTextOnly } from '@/lib/sms-text';
import { sendWhatsAppTextOtp } from '@/lib/whatsapp/meta-cloud';

// ---------- Types ----------
export interface OtpTarget {
  email?: string;
  mobile?: string;
  /** User ID — for audit logging */
  userId?: string;
  /** Tenant ID — for audit logging */
  tenantId?: string;
  /** Purpose tag */
  purpose: 'login' | 'register' | 'reset' | 'workspace_switch';
}

export interface OtpDispatchResult {
  ok: boolean;
  primaryChannel: 'email' | 'sms' | 'whatsapp' | 'none';
  emailDelivered: boolean;
  smsDelivered: boolean;
  whatsappDelivered: boolean;
  fallbackReason?: string;
  auditId?: string;
}

// ---------- Constants ----------
const ADMIN_BYPASS_EMAILS = [
  'admin@bizbook.pro',
  (process.env.ADMIN_EMAIL || '').toLowerCase(),
  (process.env.INFRASTRUCTURE_OWNER_EMAIL || '').toLowerCase(),
].filter(Boolean);

// ---------- Main Dispatcher ----------
export async function dispatchOtp(
  otp: string,
  target: OtpTarget
): Promise<OtpDispatchResult> {
  console.log(`[OTP] Dispatching for ${target.email || target.mobile} (purpose: ${target.purpose})`);

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

  // ---------- Admin bypass (Task 29) ----------
  // admin@bizbook.pro and INFRASTRUCTURE_OWNER_EMAIL never need OTP
  if (target.email && ADMIN_BYPASS_EMAILS.includes(target.email.toLowerCase())) {
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

  // ---------- CRITICAL SAFETY CHECK ----------
  // Master mobile (9101555075) must NEVER receive OTPs for non-admin users
  // This is the root-cause fix for "OTP goes to master mobile" bug
  const MASTER_MOBILE = process.env.MASTER_MOBILE_NUMBER || '9101555075';
  if (target.mobile && target.mobile === MASTER_MOBILE && target.email !== process.env.ADMIN_EMAIL) {
    console.error(`[OTP] ⚠️ BLOCKED: attempted to send OTP to master mobile ${MASTER_MOBILE} for non-admin user`);
    console.error(`[OTP] This indicates a routing bug. The fix: target.mobile should be the user's actual mobile, not master.`);
    // Refuse to send — fail closed
    return {
      ok: false,
      primaryChannel: 'none',
      emailDelivered: false,
      smsDelivered: false,
      whatsappDelivered: false,
      fallbackReason: `BLOCKED: cannot route OTP to master mobile for non-admin user`,
    };
  }

  const result: OtpDispatchResult = {
    ok: false,
    primaryChannel: 'none',
    emailDelivered: false,
    smsDelivered: false,
    whatsappDelivered: false,
  };

  // ---------- Track 1: Email (Primary) ----------
  if (target.email) {
    try {
      console.log(`[OTP] Track 1: Sending email to ${target.email}`);
      // Use the existing email.ts sendOtpEmail signature: (email, otp, userName?)
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
  }

  // ---------- Track 2: SMS (Secondary — only if email failed OR dual auth) ----------
  const enforceDual = process.env.ENFORCE_DUAL_AUTH === 'true';
  if ((!result.emailDelivered || enforceDual) && target.mobile) {
    try {
      console.log(`[OTP] Track 2: Sending SMS text to ${target.mobile}`);
      // CRITICAL: sendSmsTextOnly calls 2Factor /v1/SMSOTP — NOT /v1/VOICEOTP
      // Voice calls are deprecated per Spec Rule 2.1
      const smsResult = await sendSmsTextOnly({
        to: target.mobile,
        otp,
        purpose: target.purpose,
      });

      if (smsResult.ok) {
        result.smsDelivered = true;
        if (!result.ok) {
          result.primaryChannel = 'sms';
          result.ok = true;
        }
        console.log(`[OTP] ✓ SMS text delivered to ${target.mobile}`);
      } else {
        console.warn(`[OTP] ✗ SMS failed: ${smsResult.error}`);
        result.fallbackReason = (result.fallbackReason || '') + ` | SMS: ${smsResult.error}`;
      }
    } catch (err: any) {
      console.error(`[OTP] SMS exception:`, err?.message);
      result.fallbackReason = (result.fallbackReason || '') + ` | SMS exception: ${err?.message}`;
    }
  }

  // ---------- Track 3: WhatsApp (Emergency — only if SMS failed AND env configured) ----------
  if (!result.smsDelivered && !result.emailDelivered && target.mobile) {
    // Only attempt WhatsApp if access token is configured
    // (Otherwise this throws and breaks all auth — Spec Part 3 requirement)
    if (process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
      try {
        console.log(`[OTP] Track 3: Sending WhatsApp text to ${target.mobile}`);
        const waResult = await sendWhatsAppTextOtp({
          to: target.mobile,
          otp,
          purpose: target.purpose,
        });

        if (waResult.ok) {
          result.whatsappDelivered = true;
          if (!result.ok) {
            result.primaryChannel = 'whatsapp';
            result.ok = true;
          }
          console.log(`[OTP] ✓ WhatsApp delivered to ${target.mobile}`);
        } else {
          console.warn(`[OTP] ✗ WhatsApp failed: ${waResult.error}`);
        }
      } catch (err: any) {
        console.error(`[OTP] WhatsApp exception:`, err?.message);
      }
    } else {
      console.warn(`[OTP] WhatsApp not configured (WHATSAPP_ACCESS_TOKEN missing) — skipping emergency channel`);
    }
  }

  // ---------- Final audit log ----------
  await auditOtpDispatch(target, otp, result).catch(() => {});

  return result;
}

// ---------- Audit Log Helper ----------
// Uses the existing AuditLog schema (fields: userId, userName, action, entityType, entityId, entityName, changes, ipAddress, createdAt)
async function auditOtpDispatch(
  target: OtpTarget,
  otp: string,
  result: OtpDispatchResult
) {
  try {
    // Dynamically import prisma to avoid circular deps
    const { prisma } = await import('@/lib/db');
    await prisma.auditLog.create({
      data: {
        userId: target.userId || null,
        tenantId: target.tenantId || 'system',
        action: `OTP_DISPATCH:${target.purpose}`,
        entityType: 'OTP',
        entityId: target.userId || target.email || 'unknown',
        entityName: target.email ? `${target.email.slice(0, 3)}***` : (target.mobile ? `${target.mobile.slice(0, 4)}***` : 'unknown'),
        changes: JSON.stringify({
          emailDelivered: result.emailDelivered,
          smsDelivered: result.smsDelivered,
          whatsappDelivered: result.whatsappDelivered,
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

// ---------- Helper: Resolve user's contact info from DB ----------
// This is the function that was BROKEN — it used to return master mobile
// as fallback. Now it returns null if user has no mobile, forcing the
// caller to handle the missing case properly.
//
// IMPORTANT: In this repo's schema, `User` has only `email` (no phone field).
// Mobile lives on `Tenant.phone`. So this helper resolves the user's email
// AND looks up their active tenant's phone.
export async function resolveUserContact(userId: string, tenantId?: string): Promise<{
  email: string | null;
  mobile: string | null;
} | null> {
  const { prisma } = await import('@/lib/db');
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, tenantId: true },
  });

  if (!user) return null;

  // Look up mobile from tenant (where the phone field lives in this schema)
  let mobile: string | null = null;
  const effectiveTenantId = tenantId || user.tenantId;
  if (effectiveTenantId) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: effectiveTenantId },
      select: { phone: true },
    });
    mobile = tenant?.phone || null;
  }

  return {
    email: user.email,
    // CRITICAL: Return user's ACTUAL mobile (from Tenant.phone), NOT process.env.MASTER_MOBILE_NUMBER
    // If tenant has no phone, return null (let caller decide what to do)
    mobile,
  };
}

/*
 * ============================================================================
 * REPLACEMENT GUIDE — Where to use this dispatcher
 * ============================================================================
 *
 * Find all places in your codebase that currently send OTPs. Replace patterns:
 *
 * --- PATTERN 1: Direct nodemailer usage (BROKEN) ---
 *
 *   // OLD (broken):
 *   const info = await transporter.sendMail({
 *     from: process.env.SMTP_USER,
 *     to: user.email,  // sometimes hardcoded to admin email!
 *     ...
 *   });
 *
 *   // NEW:
 *   import { dispatchOtp } from '@/lib/otp/dispatcher';
 *   const result = await dispatchOtp(otp, {
 *     email: user.email,
 *     mobile: user.mobile,  // user's actual mobile, NOT master
 *     userId: user.id,
 *     tenantId: user.activeTenantId,
 *     purpose: 'login',
 *   });
 *
 * --- PATTERN 2: 2Factor voice OTP (BROKEN — voice deprecated) ---
 *
 *   // OLD (broken):
 *   await axios.get(`https://2factor.in/API/V1/${apiKey}/VOICE/${otp}/${mobile}`);
 *   //                              ^^^^^ ^^^^^ — voice call!
 *
 *   // NEW:
 *   import { sendSmsTextOnly } from '@/lib/sms/2factor-text';
 *   await sendSmsTextOnly({ to: mobile, otp, purpose: 'login' });
 *
 * --- PATTERN 3: Master mobile fallback (BROKEN — critical bug) ---
 *
 *   // OLD (broken):
 *   const sendTo = user.mobile || process.env.MASTER_MOBILE_NUMBER;
 *   //                                  ^^^^^^^^^^^^^^^^^^^^^^^^^
 *   //                                  THIS IS THE BUG
 *
 *   // NEW:
 *   const sendTo = user.mobile;  // user's own mobile only
 *   if (!sendTo) {
 *     // Handle missing mobile — prompt user to add mobile in settings
 *     return res.status(400).json({ error: 'NO_MOBILE_REGISTERED' });
 *   }
 *
 * ============================================================================
 * UI TEXT UPDATE (per Spec Part 3 Rule 1.1)
 * ============================================================================
 *
 * Find this text in your components (likely cover.tsx or login form):
 *   "master mobile"  (any reference)
 *
 * Replace with:
 *   "Please check your email inbox/spam for the 6-digit OTP. If email
 *    delivery fails, the OTP will be securely sent directly to your
 *    registered tenant mobile number as a backup channel."
 * ============================================================================
 */
