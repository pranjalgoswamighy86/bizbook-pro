import axios from 'axios';

interface AIProvider {
  name: string;
  analyze: (prompt: string, context?: string) => Promise<string>;
  analyzeVision?: (imageBase64: string, prompt: string) => Promise<string>;
}

// ---------- DeepSeek (Primary) ----------
class DeepSeekProvider implements AIProvider {
  name = 'DeepSeek';
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY || '';
    if (!this.apiKey) console.warn('[DeepSeek] No API key set – provider will fail.');
  }

  async analyze(prompt: string, context?: string): Promise<string> {
    if (!this.apiKey) throw new Error('DeepSeek API key missing');
    const url = 'https://api.deepseek.com/v1/chat/completions';
    const messages = [
      { role: 'system', content: 'You are a helpful business AI for BizBook Pro. Respond in English only.' },
      { role: 'user', content: context ? `Context: ${context}\n\n${prompt}` : prompt }
    ];
    try {
      const res = await axios.post(url, {
        model: 'deepseek-chat',
        messages,
        temperature: 0.3,
        max_tokens: 2000,
      }, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        timeout: 30000,
      });
      return res.data.choices[0].message.content;
    } catch (err: any) {
      console.error('[DeepSeek]', err.response?.data || err.message);
      throw new Error(`DeepSeek failed: ${err.response?.data?.error?.message || err.message}`);
    }
  }

  async analyzeVision(_: string, __: string): Promise<string> {
    throw new Error('DeepSeek does not support vision. Use OpenAI or Gemini.');
  }
}

// ---------- OpenAI (Vision Fallback) ----------
class OpenAIProvider implements AIProvider {
  name = 'OpenAI';
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || '';
  }

  async analyze(prompt: string, context?: string): Promise<string> {
    if (!this.apiKey) throw new Error('OpenAI API key missing');
    const url = 'https://api.openai.com/v1/chat/completions';
    const messages = [
      { role: 'system', content: 'You are a helpful business AI for BizBook Pro.' },
      { role: 'user', content: context ? `Context: ${context}\n\n${prompt}` : prompt }
    ];
    const res = await axios.post(url, {
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.3,
      max_tokens: 2000,
    }, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      timeout: 30000,
    });
    return res.data.choices[0].message.content;
  }

  async analyzeVision(imageBase64: string, prompt: string): Promise<string> {
    if (!this.apiKey) throw new Error('OpenAI API key missing');
    const url = 'https://api.openai.com/v1/chat/completions';
    const res = await axios.post(url, {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
        ]}
      ],
      max_tokens: 2000,
    }, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      timeout: 45000,
    });
    return res.data.choices[0].message.content;
  }
}

// ---------- Gemini (Vision Fallback) ----------
class GeminiProvider implements AIProvider {
  name = 'Gemini';
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || '';
  }

  async analyze(prompt: string, context?: string): Promise<string> {
    if (!this.apiKey) throw new Error('Gemini API key missing');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.apiKey}`;
    const res = await axios.post(url, {
      contents: [{
        parts: [{ text: context ? `Context: ${context}\n\n${prompt}` : prompt }]
      }]
    }, { timeout: 30000 });
    return res.data.candidates[0].content.parts[0].text;
  }

  async analyzeVision(imageBase64: string, prompt: string): Promise<string> {
    if (!this.apiKey) throw new Error('Gemini API key missing');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.apiKey}`;
    const res = await axios.post(url, {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }
        ]
      }]
    }, { timeout: 45000 });
    return res.data.candidates[0].content.parts[0].text;
  }
}

// ---------- Claude (Text Fallback) ----------
class ClaudeProvider implements AIProvider {
  name = 'Claude';
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY || '';
  }

  async analyze(prompt: string, context?: string): Promise<string> {
    if (!this.apiKey) throw new Error('Claude API key missing');
    const url = 'https://api.anthropic.com/v1/messages';
    const res = await axios.post(url, {
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 2000,
      messages: [{ role: 'user', content: context ? `Context: ${context}\n\n${prompt}` : prompt }]
    }, {
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
    return res.data.content[0].text;
  }
}

// ---------- Main exported function ----------
export async function analyzeWithAI(
  prompt: string,
  context?: string,
  imageBase64?: string
): Promise<{ provider: string; result: string }> {
  const providers: AIProvider[] = [];

  // v6.14: Priority order for user-facing AI features:
  // 1. Gemini (free tier, reliable, supports vision)
  // 2. OpenAI (reliable, but costs money)
  // 3. DeepSeek (cheap, but less reliable)
  // 4. Anthropic (high quality, but expensive)
  // ZAI is NOT used for user-facing features (too many rate limit errors)
  if (process.env.GEMINI_API_KEY) providers.push(new GeminiProvider());
  if (process.env.OPENAI_API_KEY) providers.push(new OpenAIProvider());
  if (process.env.DEEPSEEK_API_KEY) providers.push(new DeepSeekProvider());
  if (process.env.ANTHROPIC_API_KEY) providers.push(new ClaudeProvider());

  if (providers.length === 0) {
    // v6.14: Fallback to ZAI if no other provider is configured
    // (ZAI is still used internally for development)
    try {
      const { getZaiClient } = await import('@/lib/zai-client')
      const zai = await getZaiClient()
      const response = await zai.chat.completions.create({
        messages: [
          { role: 'system', content: 'You are a helpful assistant for BizBook Pro accounting software.' },
          { role: 'user', content: context ? `${context}\n\nQuestion: ${prompt}` : prompt },
        ],
      })
      return { provider: 'ZAI (fallback)', result: response.choices[0]?.message?.content || 'No response' }
    } catch (zaiErr: any) {
      throw new Error('No AI provider configured. Set GEMINI_API_KEY (recommended, free) or OPENAI_API_KEY. ZAI fallback also failed: ' + zaiErr.message)
    }
  }

  let lastError: Error | null = null;
  for (const provider of providers) {
    try {
      let result: string;
      if (imageBase64 && provider.analyzeVision) {
        result = await provider.analyzeVision(imageBase64, prompt);
      } else {
        result = await provider.analyze(prompt, context);
      }
      return { provider: provider.name, result };
    } catch (err: any) {
      console.warn(`[${provider.name}] failed:`, err.message);
      lastError = err;
    }
  }

  // v6.19.1: ALL configured providers failed — fall back to ZAI as last resort
  // (Previously, ZAI was only used when NO providers were configured. Now it
  // also catches the case where all 4 providers fail at runtime — e.g.,
  // Gemini 400, OpenAI 429, DeepSeek insufficient balance, Anthropic error.)
  console.warn('[AI] All configured providers failed. Falling back to ZAI...');
  try {
    const { getZaiClient } = await import('@/lib/zai-client')
    const zai = await getZaiClient()
    const response = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are a helpful assistant for BizBook Pro accounting software. Respond in English only.' },
        { role: 'user', content: context ? `${context}\n\nQuestion: ${prompt}` : prompt },
      ],
    })
    return { provider: 'ZAI (emergency fallback)', result: response.choices[0]?.message?.content || 'No response' }
  } catch (zaiErr: any) {
    console.error('[AI] ZAI fallback also failed:', zaiErr.message);
    throw lastError || new Error(`All AI providers failed. ZAI fallback also failed: ${zaiErr.message}`);
  }
}
