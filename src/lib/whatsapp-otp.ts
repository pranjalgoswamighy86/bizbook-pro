/**
 * WhatsApp OTP Fail-Safe Route
 *
 * Per spec: "Emergency WhatsApp Text OTP Fail-Safe Routing Pipeline"
 *
 * When SMS and email both fail, this module sends the OTP via WhatsApp
 * using the Meta Cloud API. If the cloud API fails, it falls back to
 * a self-hosted automation node (e.g., Baileys).
 *
 * Environment variables:
 *   WHATSAPP_ACCESS_TOKEN     — Meta Cloud API access token
 *   WHATSAPP_PHONE_NUMBER_ID  — Meta Cloud API phone number ID
 *   WHATSAPP_VERSION           — API version (default: v21.0)
 *   LOCAL_AUTOMATION_NODE_URL  — Self-hosted WhatsApp automation URL (optional)
 */

interface WhatsAppResult {
  success: boolean
  error?: string
  channel?: 'cloud' | 'self-hosted' | 'none'
}

export function isWhatsAppConfigured(): boolean {
  return !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)
}

/**
 * Normalize phone to international format (91XXXXXXXXXX)
 */
function normalizePhone(phone: string): string {
  const clean = phone.replace(/\D/g, '')
  if (clean.length === 10) return `91${clean}`
  if (clean.length === 11 && clean.startsWith('0')) return `91${clean.slice(1)}`
  if (clean.length === 12 && clean.startsWith('91')) return clean
  if (clean.length >= 12) return `91${clean.slice(-10)}`
  return clean
}

/**
 * Send OTP via WhatsApp Business Cloud API
 * Falls back to self-hosted automation node if cloud fails
 */
export async function sendWhatsAppOTP(phone: string, otp: string): Promise<WhatsAppResult> {
  const standardizedNumber = normalizePhone(phone)

  // === Track 3a: Meta Cloud API ===
  if (isWhatsAppConfigured()) {
    try {
      const version = process.env.WHATSAPP_VERSION || 'v21.0'
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!
      const accessToken = process.env.WHATSAPP_ACCESS_TOKEN!

      const metaApiUrl = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: standardizedNumber,
        type: 'template',
        template: {
          name: process.env.WHATSAPP_TEMPLATE_NAME || 'bizbook_pro_verification',
          language: { code: 'en_US' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: otp }
              ]
            }
          ]
        }
      }

      console.log(`[WHATSAPP] Sending OTP to ${standardizedNumber} via Meta Cloud API`)
      const response = await fetch(metaApiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        const data = await response.json()
        console.log(`[WHATSAPP] ✅ OTP sent to ${standardizedNumber} via Cloud API (messageId: ${data.messages?.[0]?.id || 'unknown'})`)
        return { success: true, channel: 'cloud' }
      } else {
        const errorText = await response.text()
        console.error(`[WHATSAPP] ❌ Cloud API failed: HTTP ${response.status} — ${errorText}`)
      }
    } catch (error: any) {
      console.error('[WHATSAPP] Cloud API exception:', error.message)
    }
  }

  // === Track 3b: Self-hosted automation node (Baileys / custom) ===
  if (process.env.LOCAL_AUTOMATION_NODE_URL) {
    try {
      console.log(`[WHATSAPP] Falling back to self-hosted automation node: ${process.env.LOCAL_AUTOMATION_NODE_URL}`)
      const response = await fetch(`${process.env.LOCAL_AUTOMATION_NODE_URL}/send-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: standardizedNumber,
          message: `[BizBook Pro] Your verification OTP is: ${otp}. Valid for 5 minutes. Do not share with anyone.`,
        }),
      })

      if (response.ok) {
        console.log(`[WHATSAPP] ✅ OTP sent to ${standardizedNumber} via self-hosted node`)
        return { success: true, channel: 'self-hosted' }
      } else {
        const errorText = await response.text()
        console.error(`[WHATSAPP] ❌ Self-hosted node failed: ${errorText}`)
      }
    } catch (error: any) {
      console.error('[WHATSAPP] Self-hosted node exception:', error.message)
    }
  }

  console.error('[WHATSAPP] All WhatsApp channels exhausted')
  return { success: false, error: 'All WhatsApp channels exhausted', channel: 'none' }
}
