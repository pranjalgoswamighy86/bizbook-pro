/**
 * ZAI SDK Helper — v4.50
 * =====================
 * Wraps z-ai-web-dev-sdk with a fallback config so it works on Railway
 * (where /etc/.z-ai-config doesn't exist by default).
 *
 * v4.192: Made the SDK import dynamic + optional so the build does not fail
 * when z-ai-web-dev-sdk is not installed (e.g., Railway production).
 * The SDK is only loaded on demand when getZaiClient() is actually called.
 * If the SDK cannot be loaded, getZaiClient() throws a clear error and
 * isZaiAvailable() returns false — callers should check before using.
 *
 * Usage:
 *   import { getZaiClient, isZaiAvailable } from '@/lib/zai-client'
 *   if (!isZaiAvailable()) return res.status(503).json({ error: 'AI features unavailable' })
 *   const zai = await getZaiClient()
 *   const response = await zai.chat.completions.create({...})
 *
 * Config priority:
 *   1. Try ZAI.create() — works if .z-ai-config file exists (local dev)
 *   2. Fallback: use new ZAI(config) with hardcoded config from env vars
 *      or default ZAI public credentials
 */

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedClient: any | null = null
let sdkLoadAttempted = false
let sdkLoadError: string | null = null

// Dynamically load the SDK so the build does not fail when the package is missing.
// We use eval('require') to bypass Next.js's static analysis of the import.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadZaiSdk(): Promise<any> {
  if (sdkLoadAttempted) {
    if (sdkLoadError) throw new Error(sdkLoadError)
    return cachedClient
  }
  sdkLoadAttempted = true
  try {
    // Dynamic require — works in Node runtime (server-side only)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = await import(/* @vite-ignore */ 'z-ai-web-dev-sdk').catch(() => null as any)
    if (!mod || !mod.default) {
      sdkLoadError = 'z-ai-web-dev-sdk is not installed. Run: npm install z-ai-web-dev-sdk'
      throw new Error(sdkLoadError)
    }
    return mod.default
  } catch (err: any) {
    sdkLoadError = `Failed to load z-ai-web-dev-sdk: ${err?.message || 'unknown error'}`
    throw new Error(sdkLoadError)
  }
}

/**
 * Get a ZAI SDK client.
 * Tries ZAI.create() first (reads .z-ai-config file).
 * Falls back to direct constructor with DEFAULT_CONFIG if file is missing.
 * Throws if the SDK package is not installed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getZaiClient(): Promise<any> {
  if (cachedClient) return cachedClient

  const ZAISdk = await loadZaiSdk()

  // Try the standard create() method (looks for .z-ai-config file)
  try {
    cachedClient = await ZAISdk.create()
    console.log('[ZAI] Client initialized via .z-ai-config file')
    return cachedClient
  } catch (err: any) {
    console.warn('[ZAI] .z-ai-config not found, using fallback config:', err?.message)
  }

  // Fallback: use the constructor directly with our config
  // This bypasses the file lookup and works on Railway
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cachedClient = new ZAISdk(DEFAULT_CONFIG as any)
    console.log('[ZAI] Client initialized via fallback config (baseUrl:', DEFAULT_CONFIG.baseUrl + ')')
    return cachedClient
  } catch (err: any) {
    console.error('[ZAI] Fallback config failed:', err?.message)
    throw new Error(`Failed to initialize ZAI SDK: ${err?.message}`)
  }
}

/**
 * Check if ZAI SDK is available (package installed).
 * Returns false if the package could not be loaded.
 */
export function isZaiAvailable(): boolean {
  if (!sdkLoadAttempted) return true // optimistically allow call to attempt load
  return cachedClient !== null || sdkLoadError === null
}

/**
 * Get the SDK load error (for diagnostics).
 */
export function getZaiLoadError(): string | null {
  return sdkLoadError
}
