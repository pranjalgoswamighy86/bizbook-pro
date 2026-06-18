/**
 * WhatsApp Business API — Text OTP Fail-Safe
 * ------------------------------------------
 * Spec Part 3.3: WhatsApp is the TERTIARY fail-safe channel.
 * Only invoked when BOTH email AND SMS have failed.
 *
 * REQUIRES (from owner):
 *   - WHATSAPP_ACCESS_TOKEN env var (from Meta for Developers)
 *   - WHATSAPP_PHONE_NUMBER_ID env var
 *   - WHATSAPP_VERSION env var (e.g., v18.0)
 *   - Pre-approved template: bizbook_pro_auth_verification
 *
 * SAFETY: This module self-disables if WHATSAPP_ACCESS_TOKEN is missing.
 *         Caller (dispatcher.ts) checks env before calling — but we double-check
 *         here too to prevent runtime crashes.
 *
 * PLACE AT: lib/whatsapp/meta-cloud.ts
 */

import axios from 'axios';

// ---------- Types ----------
export interface WhatsAppOtpPayload {
  to: string;
  otp: string;
  purpose: 'login' | 'register' | 'reset' | 'workspace_switch';
}

export interface WhatsAppResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

// ---------- Constants ----------
const WHATSAPP_API_BASE = 'https://graph.facebook.com';
const TEMPLATE_NAME = 'bizbook_pro_auth_verification';

// ---------- Main sender ----------
export async function sendWhatsAppTextOtp(payload: WhatsAppOtpPayload): Promise<WhatsAppResult> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_VERSION || 'v18.0';

  // ---------- Self-disable if not configured ----------
  if (!accessToken || !phoneNumberId) {
    return {
      ok: false,
      error: 'WhatsApp not configured — WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID missing',
    };
  }

  // ---------- Sanitize phone ----------
  // Meta expects international format without + (e.g., 919101555075)
  let phone = payload.to.replace(/\D/g, '');
  if (!phone.startsWith('91') && phone.length === 10) {
    phone = `91${phone}`;
  } else if (phone.startsWith('0')) {
    phone = `91${phone.slice(1)}`;
  }

  if (phone.length < 12) {
    return {
      ok: false,
      error: `Invalid phone for WhatsApp: ${payload.to} (expected 12 digits with 91 prefix)`,
    };
  }

  // ---------- Build Meta Cloud API payload ----------
  const url = `${WHATSAPP_API_BASE}/${apiVersion}/${phoneNumberId}/messages`;

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'template',
    template: {
      name: TEMPLATE_NAME,
      language: { code: 'en_US' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: payload.otp },
          ],
        },
        // Optional: button URL parameter for "Copy Code" button
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [
            { type: 'text', text: payload.otp },
          ],
        },
      ],
    },
  };

  try {
    console.log(`[WhatsApp] Sending OTP template to ${phone} (purpose: ${payload.purpose})`);

    const response = await axios.post(url, body, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
      validateStatus: () => true,
    });

    if (response.status === 200 || response.status === 201) {
      const messageId = response.data?.messages?.[0]?.id;
      console.log(`[WhatsApp] ✓ Delivered to ${phone} (id: ${messageId})`);
      return { ok: true, messageId };
    }

    // Common errors
    const errData = response.data?.error;
    const errMsg = errData?.message || `HTTP ${response.status}`;
    console.error(`[WhatsApp] Meta API error: ${errMsg}`, errData);

    // If template not approved yet, fall back to plain text (if possible)
    if (errMsg.includes('Template') && errMsg.includes('not')) {
      console.warn('[WhatsApp] Template not approved. Falling back to text message...');
      return await sendPlainTextWhatsApp(phone, payload.otp, payload.purpose);
    }

    return { ok: false, error: errMsg };
  } catch (err: any) {
    console.error(`[WhatsApp] Network/axios error:`, err?.message);
    return {
      ok: false,
      error: err?.message || 'Network error',
    };
  }
}

// ---------- Fallback: plain text (no template) ----------
// Only works if recipient has messaged the WhatsApp Business number in last 24h
// (Meta's 24-hour rule). Useful as last resort when template isn't approved.
async function sendPlainTextWhatsApp(
  phone: string,
  otp: string,
  purpose: string
): Promise<WhatsAppResult> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_VERSION || 'v18.0';
  const url = `${WHATSAPP_API_BASE}/${apiVersion}/${phoneNumberId}/messages`;

  try {
    const response = await axios.post(url, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'text',
      text: {
        body: `[BizBook Pro] Your verification OTP is ${otp}. Valid for 10 minutes. Do not share it. (Purpose: ${purpose})`,
        preview_url: false,
      },
    }, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
      validateStatus: () => true,
    });

    if (response.status === 200 || response.status === 201) {
      console.log(`[WhatsApp] ✓ Plain text delivered to ${phone}`);
      return { ok: true, messageId: response.data?.messages?.[0]?.id };
    }

    return {
      ok: false,
      error: response.data?.error?.message || `HTTP ${response.status}`,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message };
  }
}

// ---------- Optional: Self-hosted WhatsApp (Baileys) ----------
// If Meta Cloud API quota exhausted, can fall back to a self-hosted
// Baileys instance. Owner must run this separately.
export async function sendViaSelfHostedWhatsApp(
  phone: string,
  otp: string
): Promise<WhatsAppResult> {
  const selfHostedUrl = process.env.LOCAL_WA_AUTOMATION_URL || process.env.LOCAL_AUTOMATION_NODE_URL;
  if (!selfHostedUrl) {
    return { ok: false, error: 'LOCAL_WA_AUTOMATION_URL / LOCAL_AUTOMATION_NODE_URL not configured' };
  }

  try {
    const response = await axios.post(`${selfHostedUrl}/api/send-text`, {
      number: phone,
      message: `[BizBook Pro] Emergency verification OTP: ${otp}. Valid 10 min. Do not share.`,
    }, { timeout: 10000 });

    if (response.status === 200) {
      return { ok: true };
    }
    return { ok: false, error: `HTTP ${response.status}` };
  } catch (err: any) {
    return { ok: false, error: err?.message };
  }
}

/*
 * ============================================================================
 * TEMPLATE SETUP (one-time, owner action)
 * ============================================================================
 *
 * 1. Go to https://developers.facebook.com → your app → WhatsApp
 * 2. Go to "Message Templates" → "Create Template"
 * 3. Configure:
 *    - Name: bizbook_pro_auth_verification
 *    - Category: Authentication
 *    - Language: en_US
 *    - Header: (none — keep simple)
 *    - Body: "Your BizBook Pro verification code is {{1}}. Valid for 10 minutes. Do not share it with anyone."
 *    - Buttons: (optional) "Copy Code" URL button with parameter {{1}}
 * 4. Submit for review — takes 1-4 hours to approve
 *
 * Until approved, dispatcher.ts will skip WhatsApp channel.
 * ============================================================================
 */
