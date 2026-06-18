/**
 * 2Factor SMS — TEXT ONLY (no voice calls)
 * ----------------------------------------
 * CRITICAL FIX: Spec Rule 2.1 mandates NO voice calls / TTS.
 *
 * 2Factor.in endpoints we use:
 *   ✅ /v1/SMSOTP/{OTP}/{PHONE}    — sends TEXT SMS (allowed)
 *   ❌ /v1/VOICEOTP/{OTP}/{PHONE}  — sends VOICE call (FORBIDDEN by spec)
 *   ❌ /v1/CALLS                   — voice call (FORBIDDEN by spec)
 *
 * The 2Factor dashboard also has a "Voice Fallback" setting that auto-converts
 * failed SMS to voice calls. Owner must DISABLE this in 2Factor dashboard
 * (see WHAT-OWNER-NEEDS-TO-DO.md Action 3).
 *
 * PLACE AT: lib/sms/2factor-text.ts
 */

import axios from 'axios';

// ---------- Types ----------
export interface SmsTextPayload {
  to: string;
  otp: string;
  purpose: 'login' | 'register' | 'reset' | 'workspace_switch';
}

export interface SmsTextResult {
  ok: boolean;
  sessionId?: string;
  error?: string;
}

// ---------- Constants ----------
const TWOFACTOR_API_KEY = process.env.TWOFACTOR_API_KEY;
const TWOFACTOR_BASE = 'https://2factor.in/API/V1';

// Template name registered in 2Factor dashboard
// Owner must create this template at https://2factor.in (see WHAT-OWNER-NEEDS-TO-DO.md)
const SMS_TEMPLATE = process.env.TWOFACTOR_TEMPLATE_NAME || 'BizBook Pro';
const SMS_SENDER_ID = process.env.TWOFACTOR_SENDER_ID || 'BIZBOK';

// ---------- Main sender ----------
export async function sendSmsTextOnly(payload: SmsTextPayload): Promise<SmsTextResult> {
  if (!TWOFACTOR_API_KEY) {
    return {
      ok: false,
      error: 'TWOFACTOR_API_KEY not configured',
    };
  }

  // ---------- Sanitize phone ----------
  // 2Factor expects 10-digit Indian mobile OR country-code-prefixed
  let phone = payload.to.replace(/\D/g, '');

  // Remove leading 91 if present (we'll add it back)
  if (phone.startsWith('91') && phone.length === 12) {
    // already has country code
  } else if (phone.length === 10) {
    // 10-digit Indian mobile — add 91 prefix
    phone = `91${phone}`;
  } else if (phone.length === 11 && phone.startsWith('0')) {
    // leading 0 — strip and add 91
    phone = `91${phone.slice(1)}`;
  } else {
    return {
      ok: false,
      error: `Invalid phone format: ${payload.to} (expected 10-digit Indian mobile)`,
    };
  }

  // ---------- CRITICAL: Use TEXT endpoint, NOT VOICE ----------
  // 2Factor URL structure: /API/V1/{API_KEY}/SMS/{OTP}/{PHONE}/{TEMPLATE}/{SENDER}
  // This is the TEXT endpoint — explicitly avoids /VOICE/ and /CALLS/
  const url = `${TWOFACTOR_BASE}/${TWOFACTOR_API_KEY}/SMS/${payload.otp}/${phone}/${encodeURIComponent(SMS_TEMPLATE)}/${SMS_SENDER_ID}`;

  try {
    console.log(`[SMS] Sending TEXT (no voice) to ${phone} (purpose: ${payload.purpose})`);

    const response = await axios.get(url, {
      timeout: 10000,
      validateStatus: () => true, // don't throw on non-2xx
    });

    const data = response.data;

    // 2Factor returns: { Status: 'Success', Details: 'session-id' }
    if (data?.Status === 'Success') {
      console.log(`[SMS] ✓ Text SMS delivered to ${phone} (session: ${data.Details})`);
      return {
        ok: true,
        sessionId: data.Details,
      };
    }

    // Common error cases
    if (data?.Status === 'Error' || data?.Status === 'Failed') {
      const errMsg = data.Details || data.Errors?.[0] || 'Unknown 2Factor error';
      console.error(`[SMS] 2Factor returned error: ${errMsg}`);
      return { ok: false, error: errMsg };
    }

    // Unexpected response shape
    console.error('[SMS] Unexpected 2Factor response:', JSON.stringify(data));
    return {
      ok: false,
      error: `Unexpected response: ${JSON.stringify(data).slice(0, 200)}`,
    };
  } catch (err: any) {
    console.error(`[SMS] Network/axios error:`, err?.message);
    return {
      ok: false,
      error: err?.message || 'Network error',
    };
  }
}

// ---------- Helper: Check SMS balance ----------
// Useful for monitoring — if balance hits 0, all SMS will fail
export async function checkSmsBalance(): Promise<{ balance: number | null; error?: string }> {
  if (!TWOFACTOR_API_KEY) {
    return { balance: null, error: 'TWOFACTOR_API_KEY not configured' };
  }

  try {
    const url = `${TWOFACTOR_BASE}/${TWOFACTOR_API_KEY}/BALANCE`;
    const response = await axios.get(url, { timeout: 5000 });
    if (response.data?.Status === 'Success') {
      return { balance: parseFloat(response.data.Details) };
    }
    return { balance: null, error: response.data?.Details || 'Unknown error' };
  } catch (err: any) {
    return { balance: null, error: err?.message };
  }
}

/*
 * ============================================================================
 * VERIFICATION (after deploying this file)
 * ============================================================================
 *
 * 1. Check 2Factor dashboard at https://2factor.in → API Keys → SMS Logs
 *    You should see only "SMS" entries — NO "Voice" entries.
 *
 * 2. If you see Voice entries:
 *    - 2Factor dashboard → SMS Settings → DISABLE "Voice Fallback"
 *    - This is the auto-conversion of failed SMS to voice calls
 *
 * 3. Test: trigger an OTP for a non-master-mobile user
 *    - User should receive TEXT SMS — NOT a phone call
 *    - Railway logs should show: [SMS] ✓ Text SMS delivered to xxxxx
 *
 * ============================================================================
 * TEMPLATE REGISTRATION (one-time setup)
 * ============================================================================
 *
 * 1. Log in to https://2factor.in
 * 2. Go to: SMS → Templates → Add Template
 * 3. Template Name: BizBook Pro
 * 4. Sender ID: BIZBOK (auto-approved for transactional)
 * 5. Body: Your BizBook Pro verification code is #OTP#. Valid for 10 minutes. Do not share.
 * 6. Type: Transactional (OTP)
 * 7. Submit for DLT approval (may take 24-48 hours without DLT registration)
 *
 * Until DLT is registered, SMS may fail for some carriers — that's when
 * the WhatsApp fail-safe (Track 3 in dispatcher.ts) kicks in.
 * ============================================================================
 */
