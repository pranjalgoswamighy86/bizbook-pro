/**
 * openHelpChat — Global trigger for the AI Support Chat (v6.17)
 * =============================================================
 *
 * The HelpModal is mounted in 3 places:
 *   - Sidebar (main app)
 *   - CoverPage (login screen)
 *   - CompanySelectPage (company selection)
 *
 * Only ONE of these is visible at any time. Rather than threading
 * a callback through the component tree, we use a global CustomEvent.
 * Whichever HelpModal is currently mounted catches the event and
 * opens itself on the 'chat' tab.
 *
 * Usage:
 *   import { openHelpChat } from '@/lib/help-chat-trigger'
 *   openHelpChat()   // opens AI Support Chat modal
 *
 * Wired to:
 *   - F1 keyboard shortcut (page.tsx)
 *   - Electron "Help → AI Support Chat" menu (MenuActionBridge)
 *   - "AI Support Chat" sidebar item (if applicable)
 */

const HELP_CHAT_EVENT = 'bizbook:open-help-chat'

/** Fire the global event. Any mounted HelpModal listener will catch it. */
export function openHelpChat(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(HELP_CHAT_EVENT))
}

/**
 * Subscribe to the open-help-chat event.
 * Returns an unsubscribe function.
 *
 * Used by the 3 HelpModal mount points to catch F1 / menu triggers.
 */
export function onOpenHelpChat(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => callback()
  window.addEventListener(HELP_CHAT_EVENT, handler)
  return () => window.removeEventListener(HELP_CHAT_EVENT, handler)
}
