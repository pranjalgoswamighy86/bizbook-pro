/**
 * Brevo (Sendinblue) Email API — HTTPS-based, no SMTP ports needed
 * ================================================================
 * Works on Railway (uses HTTPS port 443, not blocked).
 * Free tier: 300 emails/day.
 * Can send FROM pranjalgoswamighy86@gmail.com TO any email.
 * No domain verification required — just verify sender email.
 *
 * ENV VARS:
 *   BREVO_API_KEY = xkeysib-xxxxxxxxxxxx
 *   BREVO_FROM_EMAIL = pranjalgoswamighy86@gmail.com
 *   BREVO_FROM_NAME = BizBook Pro
 */

import axios from 'axios';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

export function isBrevoConfigured(): boolean {
  return !!process.env.BREVO_API_KEY;
}

export async function sendViaBrevo(
  email: string,
  otp: string,
  userName?: string
): Promise<{ success: boolean; error?: string }> {
  if (!isBrevoConfigured()) {
    return { success: false, error: 'BREVO_NOT_CONFIGURED' };
  }

  const fromEmail = process.env.BREVO_FROM_EMAIL || 'pranjalgoswamighy86@gmail.com';
  const fromName = process.env.BREVO_FROM_NAME || 'BizBook Pro';

  try {
    console.log(`[EMAIL][BREVO] Sending OTP to ${email} from ${fromEmail}`);

    const response = await axios.post(
      BREVO_API_URL,
      {
        sender: { name: fromName, email: fromEmail },
        to: [{ email, name: userName || email }],
        subject: 'BizBook Pro — Your Verification OTP',
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <div style="background: linear-gradient(135deg, #059669, #047857); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 22px;">BizBook Pro</h1>
              <p style="color: #d1fae5; margin: 4px 0 0; font-size: 13px;">A Product by Tahigo International</p>
            </div>
            <div style="background: #f9fafb; padding: 32px; border: 1px solid #e5e7eb; border-radius: 0 0 12px 12px;">
              <p style="margin: 0 0 16px; font-size: 14px; color: #111827;">Hello${userName ? ` ${userName}` : ''},</p>
              <p style="margin: 0 0 24px; font-size: 14px; color: #6b7280;">Use the OTP below to verify your identity.</p>
              <div style="background: white; border: 2px dashed #059669; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 24px;">
                <p style="font-size: 32px; font-weight: 800; color: #059669; letter-spacing: 8px; margin: 0; font-family: monospace;">${otp}</p>
              </div>
              <p style="font-size: 12px; color: #6b7280; margin: 0;">This OTP expires in 5 minutes. If you didn't request this, ignore this email.</p>
            </div>
          </div>
        `,
        textContent: `Your BizBook Pro verification OTP is: ${otp}. Valid for 5 minutes.`,
      },
      {
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json',
          'accept': 'application/json',
        },
        timeout: 15000,
        validateStatus: () => true,
      }
    );

    if (response.status === 200 || response.status === 201) {
      console.log(`[EMAIL][BREVO] ✅ OTP sent to ${email} (id: ${response.data?.messageId || 'n/a'})`);
      return { success: true };
    }

    const errMsg = response.data?.message || response.data?.code || `HTTP ${response.status}`;
    console.error(`[EMAIL][BREVO] ❌ API error:`, errMsg);
    return { success: false, error: `BREVO: ${errMsg}` };
  } catch (err: any) {
    console.error(`[EMAIL][BREVO] ❌ Exception:`, err?.message);
    return { success: false, error: err?.message || 'BREVO network error' };
  }
}
