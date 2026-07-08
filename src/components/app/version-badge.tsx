'use client'

/**
 * VersionBadge — v6.16
 * ====================
 * A tiny, always-visible badge that shows the deployed web app version
 * AND (when running inside Electron) the desktop shell version.
 *
 * Purpose:
 *   - Sets `window.__BIZBOOK_VERSION__` so the Electron main process can
 *     read it via `executeJavaScript` and log it for diagnostics.
 *   - Renders a small badge in the bottom-right corner so users can
 *     instantly confirm which build is actually loaded (web + desktop).
 *   - When running inside Electron, also pings the desktop shell via
 *     `electron.ping()` and shows the desktop version.
 *
 * This is the single most useful diagnostic tool for the "menu bar
 * doesn't work" issue — if the badge shows an OLD version number,
 * the user knows they need to hard-refresh / restart the app.
 */

import { useEffect, useState } from 'react'
import { APP_VERSION, APP_BUILD_DATE } from '@/lib/version'

interface DesktopInfo {
  desktopVersion: string
  electron: string
}

export function VersionBadge() {
  const [desktopInfo, setDesktopInfo] = useState<DesktopInfo | null>(null)
  const [expanded, setExpanded] = useState(false)

  // Expose version globally for Electron diagnostics
  useEffect(() => {
    if (typeof window === 'undefined') return
    ;(window as any).__BIZBOOK_VERSION__ = APP_VERSION
    ;(window as any).__BIZBOOK_BUILD_DATE__ = APP_BUILD_DATE
  }, [])

  // Ping the Electron shell to confirm the bridge is alive
  useEffect(() => {
    if (typeof window === 'undefined') return
    const electronAPI = (window as any).electron
    if (!electronAPI?.ping) return
    electronAPI.ping()
      .then((res: any) => {
        if (res?.ok) {
          setDesktopInfo({
            desktopVersion: res.desktopVersion,
            electron: res.electron,
          })
        }
      })
      .catch(() => {})
  }, [])

  return (
    <div
      className="fixed bottom-1 right-1 z-[9999] pointer-events-auto select-none"
      style={{ fontSize: '10px' }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="px-1.5 py-0.5 rounded bg-black/60 text-white/80 hover:bg-black/80 hover:text-white transition-colors font-mono border border-white/10"
        title="Click to expand version info"
      >
        {APP_VERSION}
        {desktopInfo ? ` · desktop v${desktopInfo.desktopVersion}` : ''}
      </button>
      {expanded && (
        <div className="absolute bottom-5 right-0 bg-black/85 text-white/90 text-[10px] font-mono px-2 py-1.5 rounded border border-white/10 whitespace-nowrap">
          <div>Web: {APP_VERSION} ({APP_BUILD_DATE})</div>
          {desktopInfo ? (
            <>
              <div>Desktop: v{desktopInfo.desktopVersion}</div>
              <div>Electron: {desktopInfo.electron}</div>
            </>
          ) : (
            <div>Desktop: not detected (web browser)</div>
          )}
        </div>
      )}
    </div>
  )
}
