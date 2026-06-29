/**
 * Multi-Provider AI Client — v4.128
 * ==================================
 * Provides AI analysis using MULTIPLE providers:
 *   1. ZAI (Z.ai) — primary, already configured
 *   2. OpenAI (ChatGPT) — fallback if OPENAI_API_KEY is set
 *   3. Google Gemini — fallback if GEMINI_API_KEY is set
 *   4. Anthropic Claude — fallback if ANTHROPIC_API_KEY is set
 *
 * The system tries each provider in order. If one fails (timeout, auth error,
 * rate limit), it falls back to the next. If all fail, the caller can use
 * the local parser as a last resort.
 *
 * Why multi-provider?
 *   - Different AI models have different strengths
 *   - One provider may be down while another works
 *   - The user may have API keys for multiple providers
 *   - A "Smart" system should use ALL available intelligence
 *
 * Environment variables (all optional — set any one on Railway):
 *   ZAI_API_KEY          — Z.ai API key (already configured via .z-ai-config)
 *   OPENAI_API_KEY       — OpenAI/ChatGPT API key (from platform.openai.com)
 *   GEMINI_API_KEY       — Google Gemini API key (from aistudio.google.com)
 *   ANTHROPIC_API_KEY    — Anthropic Claude API key (from console.anthropic.com)
 *
 * Usage:
 *   import { analyzeWithAI, getAvailableProviders } from '@/lib/multi-ai'
 *   const result = await analyzeWithAI(messages, { vision: true })
 *   console.log('Analyzed by:', result.provider) // 'zai' | 'openai' | 'gemini' | 'claude'
 */

// ============================================================
// Types
// ============================================================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
    | { type: 'file_url'; file_url: { url: string } }
  >
}

export interface AIResult {
  provider: string // 'zai' | 'openai' | 'gemini' | 'claude'
  content: string // The AI's response text
  model?: string // Which model was used
  tokensUsed?: number
}

export interface AIError {
  provider: string
  error: string
}

// ============================================================
// Provider Registry
// ============================================================

export function getAvailableProviders(): string[] {
  const providers: string[] = []

  // ZAI — always available (has fallback config)
  providers.push('zai')

  // OpenAI — available if API key is set
  if (process.env.OPENAI_API_KEY) {
    providers.push('openai')
  }

  // Gemini — available if API key is set
  if (process.env.GEMINI_API_KEY) {
    providers.push('gemini')
  }

  // Anthropic Claude — available if API key is set
  if (process.env.ANTHROPIC_API_KEY) {
    providers.push('claude')
  }

  return providers
}

// ============================================================
// Provider 1: ZAI (Z.ai)
// ============================================================

async function analyzeWithZAI(
  messages: ChatMessage[],
  options: { vision?: boolean; timeout?: number; jsonMode?: boolean } = {}
): Promise<AIResult> {
  const { getZaiClient } = await import('@/lib/zai-client')
  const zai = await getZaiClient()

  const hasVision = options.vision && messages.some(
    m => Array.isArray(m.content) && m.content.some(c => c.type === 'image_url' || c.type === 'file_url')
  )

  let response: any
  if (hasVision) {
    // Use vision API
    response = await zai.chat.completions.createVision({
      messages: messages as any,
      thinking: { type: 'disabled' },
    } as any)
  } else {
    // Use regular chat API
    response = await zai.chat.completions.create({
      messages: messages as any,
    })
  }

  const content = response.choices?.[0]?.message?.content || ''
  if (!content) throw new Error('ZAI returned empty response')

  return {
    provider: 'zai',
    content,
    model: response.model || 'zai-glm',
    tokensUsed: response.usage?.total_tokens,
  }
}

// ============================================================
// Provider 2: OpenAI (ChatGPT)
// ============================================================

async function analyzeWithOpenAI(
  messages: ChatMessage[],
  options: { vision?: boolean; timeout?: number; jsonMode?: boolean } = {}
): Promise<AIResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')

  const model = options.vision ? 'gpt-4o' : 'gpt-4o-mini'
  const timeout = options.timeout || 30000

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        max_tokens: 4096,
        temperature: 0.1,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`OpenAI API error (${response.status}): ${err.slice(0, 200)}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''
    if (!content) throw new Error('OpenAI returned empty response')

    return {
      provider: 'openai',
      content,
      model: data.model || model,
      tokensUsed: data.usage?.total_tokens,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

// ============================================================
// Provider 3: Google Gemini
// ============================================================

async function analyzeWithGemini(
  messages: ChatMessage[],
  options: { vision?: boolean; timeout?: number; jsonMode?: boolean } = {}
): Promise<AIResult> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')

  const model = options.vision ? 'gemini-1.5-flash' : 'gemini-1.5-flash'
  const timeout = options.timeout || 30000

  // Convert OpenAI-style messages to Gemini format
  const systemInstruction = messages.find(m => m.role === 'system')
  const userMessages = messages.filter(m => m.role !== 'system')

  const contents = userMessages.map(m => {
    if (typeof m.content === 'string') {
      return { parts: [{ text: m.content }], role: m.role === 'assistant' ? 'model' : 'user' }
    }
    // Handle vision content
    const parts: any[] = []
    for (const part of m.content as any[]) {
      if (part.type === 'text') parts.push({ text: part.text })
      if (part.type === 'image_url') {
        const url = part.image_url.url
        if (url.startsWith('data:')) {
          const [mimeType, data] = url.match(/^data:(.+?);base64,(.*)$/)?.slice(1) || []
          if (mimeType && data) {
            parts.push({ inline_data: { mime_type: mimeType, data } })
          }
        }
      }
    }
    return { parts, role: m.role === 'assistant' ? 'model' : 'user' }
  })

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: systemInstruction
            ? { parts: [{ text: typeof systemInstruction.content === 'string' ? systemInstruction.content : '' }] }
            : undefined,
          generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
        }),
        signal: controller.signal,
      }
    )

    clearTimeout(timeoutId)

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Gemini API error (${response.status}): ${err.slice(0, 200)}`)
    }

    const data = await response.json()
    const content = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || ''
    if (!content) throw new Error('Gemini returned empty response')

    return {
      provider: 'gemini',
      content,
      model,
      tokensUsed: data.usageMetadata?.totalTokenCount,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

// ============================================================
// Provider 4: Anthropic Claude
// ============================================================

async function analyzeWithClaude(
  messages: ChatMessage[],
  options: { vision?: boolean; timeout?: number; jsonMode?: boolean } = {}
): Promise<AIResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const model = 'claude-3-5-sonnet-20241022'
  const timeout = options.timeout || 30000

  // Convert messages to Claude format
  const systemMsg = messages.find(m => m.role === 'system')
  const systemText = typeof systemMsg?.content === 'string' ? systemMsg.content : ''
  const convMessages = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : (m.content as any[]).map(c => {
      if (c.type === 'text') return { type: 'text', text: c.text }
      if (c.type === 'image_url') {
        const url = c.image_url.url
        const match = url.match(/^data:(.+?);base64,(.*)$/)
        if (match) {
          return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }
        }
      }
      return { type: 'text', text: '' }
    }),
  }))

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemText,
        messages: convMessages,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Claude API error (${response.status}): ${err.slice(0, 200)}`)
    }

    const data = await response.json()
    const content = data.content?.map((c: any) => c.text).join('') || ''
    if (!content) throw new Error('Claude returned empty response')

    return {
      provider: 'claude',
      content,
      model,
      tokensUsed: data.usage?.input_tokens + (data.usage?.output_tokens || 0),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

// ============================================================
// Main: Try all providers in sequence
// ============================================================

const PROVIDERS = [
  { name: 'zai', fn: analyzeWithZAI },
  { name: 'openai', fn: analyzeWithOpenAI },
  { name: 'gemini', fn: analyzeWithGemini },
  { name: 'claude', fn: analyzeWithClaude },
]

/**
 * Analyze with AI — tries each provider in order.
 * Returns the first successful result.
 * If all fail, throws an error with all failure reasons.
 */
export async function analyzeWithAI(
  messages: ChatMessage[],
  options: { vision?: boolean; timeout?: number; jsonMode?: boolean } = {}
): Promise<AIResult> {
  const errors: AIError[] = []
  const available = getAvailableProviders()

  console.log(`[Multi-AI] Available providers: ${available.join(', ') || 'none'}`)
  console.log(`[Multi-AI] Vision: ${options.vision ? 'yes' : 'no'} | JSON mode: ${options.jsonMode ? 'yes' : 'no'}`)

  for (const provider of PROVIDERS) {
    // Skip providers that aren't configured
    if (!available.includes(provider.name)) continue

    try {
      console.log(`[Multi-AI] Trying ${provider.name}...`)
      const result = await provider.fn(messages, options)
      console.log(`[Multi-AI] ✓ ${provider.name} succeeded (${result.tokensUsed || '?'} tokens)`)
      return result
    } catch (err: any) {
      const errorMsg = err?.message?.slice(0, 200) || 'Unknown error'
      console.warn(`[Multi-AI] ✗ ${provider.name} failed: ${errorMsg}`)
      errors.push({ provider: provider.name, error: errorMsg })
    }
  }

  // All providers failed
  throw new Error(
    `All AI providers failed: ${errors.map(e => `${e.provider} (${e.error})`).join('; ')}. ` +
    `Available providers: ${available.join(', ') || 'none'}. ` +
    `Set OPENAI_API_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY on Railway for additional providers.`
  )
}
