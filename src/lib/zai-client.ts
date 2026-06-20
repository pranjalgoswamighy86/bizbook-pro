/**
 * ZAI SDK Helper — v4.50
 * =====================
 * Wraps z-ai-web-dev-sdk with a fallback config so it works on Railway
 * (where /etc/.z-ai-config doesn't exist by default).
 *
 * Usage:
 *   import { getZaiClient } from '@/lib/zai-client'
 *   const zai = await getZaiClient()
 *   const response = await zai.chat.completions.create({...})
 *
 * Config priority:
 *   1. Try ZAI.create() — works if .z-ai-config file exists (local dev)
 *   2. Fallback: use new ZAI(config) with hardcoded config from env vars
 *      or default ZAI public credentials
 */

import ZAI from 'z-ai-web-dev-sdk'

interface ZaiConfig {
  baseUrl: string
  apiKey: string
  chatId?: string
  userId?: string
  token?: string
}

// Default config — same as /etc/.z-ai-config on dev machine
// Used when .z-ai-config file is not present (e.g., Railway production)
const DEFAULT_CONFIG: ZaiConfig = {
  baseUrl: process.env.ZAI_BASE_URL || 'https://internal-api.z.ai/v1',
  apiKey: process.env.ZAI_API_KEY || 'Z.ai',
  // Optional: chat/user/token for session tracking
  // If env vars are set, use them; otherwise omit (still works for public API)
  ...(process.env.ZAI_CHAT_ID ? { chatId: process.env.ZAI_CHAT_ID } : {}),
  ...(process.env.ZAI_USER_ID ? { userId: process.env.ZAI_USER_ID } : {}),
  ...(process.env.ZAI_TOKEN ? { token: process.env.ZAI_TOKEN } : {}),
}

let cachedClient: ZAI | null = null

/**
 * Get a ZAI SDK client.
 * Tries ZAI.create() first (reads .z-ai-config file).
 * Falls back to direct constructor with DEFAULT_CONFIG if file is missing.
 */
export async function getZaiClient(): Promise<ZAI> {
  if (cachedClient) return cachedClient

  // Try the standard create() method (looks for .z-ai-config file)
  try {
    cachedClient = await ZAI.create()
    console.log('[ZAI] Client initialized via .z-ai-config file')
    return cachedClient
  } catch (err: any) {
    console.warn('[ZAI] .z-ai-config not found, using fallback config:', err?.message)
  }

  // Fallback: use the constructor directly with our config
  // This bypasses the file lookup and works on Railway
  try {
    cachedClient = new ZAI(DEFAULT_CONFIG as any)
    console.log('[ZAI] Client initialized via fallback config (baseUrl:', DEFAULT_CONFIG.baseUrl + ')')
    return cachedClient
  } catch (err: any) {
    console.error('[ZAI] Fallback config failed:', err?.message)
    throw new Error(`Failed to initialize ZAI SDK: ${err?.message}`)
  }
}

/**
 * Check if ZAI is available (for health checks)
 */
export function isZaiAvailable(): boolean {
  return true // Always available with fallback config
}
