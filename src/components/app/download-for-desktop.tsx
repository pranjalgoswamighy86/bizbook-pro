'use client'

/**
 * Download for Desktop — PWA Install Button
 *
 * Per spec: "If this application is running in a browser, there should be a
 * 'Download for Desktop' option on the software's dashboard page."
 *
 * Uses the browser's native `beforeinstallprompt` event to trigger
 * the PWA installation dialog. On Chrome/Edge, this installs the app
 * as a standalone desktop application.
 *
 * If the browser doesn't support PWA install (Firefox/Safari), the button
 * shows a tooltip explaining how to install manually.
 */

import { useState, useEffect } from 'react'
import { Download, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function DownloadForDesktop() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [showHint, setShowHint] = useState(false)

  useEffect(() => {
    // Check if already installed (running as standalone PWA)
    if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true) {
      setInstalled(true)
      return
    }

    // Listen for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)

    // Listen for appinstalled
    const installedHandler = () => { setInstalled(true); setInstallPrompt(null) }
    window.addEventListener('appinstalled', installedHandler)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', installedHandler)
    }
  }, [])

  const handleInstall = async () => {
    if (installPrompt) {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      if (choice.outcome === 'accepted') {
        setInstalled(true)
        setInstallPrompt(null)
      }
    } else {
      // Browser doesn't support PWA install — show manual instructions
      setShowHint(!showHint)
    }
  }

  if (installed) return null

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={handleInstall}
        className="gap-2 text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300"
        title="Install BizBook Pro as a desktop app"
      >
        <Monitor className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Download for Desktop</span>
        <span className="sm:hidden">Install</span>
      </Button>

      {showHint && !installPrompt && (
        <div className="absolute top-full right-0 mt-1 p-3 bg-card border rounded-lg shadow-lg text-xs max-w-xs z-50">
          <p className="font-semibold mb-1">Install BizBook Pro:</p>
          <p className="text-muted-foreground">Chrome/Edge: Click the install icon (⊕) in the address bar.</p>
          <p className="text-muted-foreground mt-1">Safari: Share → Add to Home Screen.</p>
          <button onClick={() => setShowHint(false)} className="mt-2 text-emerald-600 hover:underline">Close</button>
        </div>
      )}
    </div>
  )
}
