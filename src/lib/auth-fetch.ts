/**
 * Authenticated fetch helper with Bearer token + automatic 401 handling.
 *
 * Strategy:
 *   1. Read the session token from the Zustand store (persisted in localStorage)
 *   2. Send it via `Authorization: Bearer <token>` header on every request
 *   3. Also send cookies via `credentials: 'include'` (belt-and-suspenders)
 *   4. On 401: clear the store + cookie + redirect to login
 *
 * Why Bearer header instead of relying on cookies?
 *   The platform's preview panel embeds the app in an iframe at
 *   preview-chat-{id}.space-z.ai. Browsers block SameSite cookies in
 *   cross-site iframes for subresource requests (fetch/XHR), even though
 *   the login cookie was set successfully. The Bearer header bypasses
 *   this entirely — it's just an HTTP header, no cookie policy applies.
 *
 * Usage (replace `fetch` with `authFetch` in modules):
 *   import { authFetch } from '@/lib/auth-fetch'
 *   const res = await authFetch('/api/reports', { method: 'POST', ... })
 */

import { useAppStore } from '@/store/app-store'

const AUTH_STORAGE_KEY = 'bizbook-auth'

/** Read the current session token from the Zustand store */
function getSessionToken(): string | null {
  try {
    return useAppStore.getState().sessionToken
  } catch {
    return null
  }
}

export async function authFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const token = getSessionToken()

  const headers = new Headers(init?.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  // Ensure JSON content type for POST requests (if not already set)
  if (init?.method && init.method.toUpperCase() !== 'GET' && !headers.has('Content-Type')) {
    const body = init.body
    if (typeof body === 'string' || body instanceof FormData === false) {
      headers.set('Content-Type', 'application/json')
    }
  }

  const res = await fetch(input, {
    ...init,
    headers,
    credentials: 'include',  // also send cookies as a fallback
  })

  if (res.status === 401) {
    // Check if this is an actual auth failure (not the login endpoint itself)
    const url = typeof input === 'string' ? input : input.toString()
    const isAuthEndpoint = url.includes('/api/auth')
    const bodyText = init?.body ? init.body.toString() : ''
    const isLoginAction = bodyText.includes('"action":"login"') ||
                         bodyText.includes('"action":"send-otp"') ||
                         bodyText.includes('"action":"register-send-otp"')

    // Only auto-logout for non-auth endpoints (auth endpoints handle 401 themselves)
    if (!isAuthEndpoint || !isLoginAction) {
      // Clear persisted Zustand state
      try {
        localStorage.removeItem(AUTH_STORAGE_KEY)
      } catch {}

      // Clear all cookies for this path (best-effort)
      document.cookie = 'bizbook_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'

      // Redirect to login by reloading the page
      // Only do this if we're not already on the login page
      if (typeof window !== 'undefined') {
        // Use a small delay to avoid infinite redirect loops
        const currentUrl = window.location.href
        if (!currentUrl.includes('login')) {
          // Force a full page reload to clear all state
          setTimeout(() => {
            window.location.href = '/'
          }, 100)
        }
      }
    }
  }

  return res
}
