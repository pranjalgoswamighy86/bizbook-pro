'use client'

/**
 * Download for Desktop — PWA Install Button (DESKTOP ONLY)
 * =========================================================
 * v4.43 UPDATE.pdf A6: Self-hides on mobile browsing.
 * The "Download Desktop" feature is desktop-only per spec.
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
  // v4.43: Self-hide on mobile browsing (UPDATE.pdf A6)
  const [isDesktop, setIsDesktop] = useState(false)

  useEffect(() => {
    const checkDesktop = () => setIsDesktop(window.innerWidth >= 900)
    checkDesktop()
    window.addEventListener('resize', checkDesktop)
    return () => window.removeEventListener('resize', checkDesktop)
  }, [])

  useEffect(() => {
    if (!isDesktop) return

    if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true) {
      setInstalled(true)
      return
    }

    const handler = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)

    const installedHandler = () => { setInstalled(true); setInstallPrompt(null) }
    window.addEventListener('appinstalled', installedHandler)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', installedHandler)
    }
  }, [isDesktop])

  const handleInstall = async () => {
    if (installPrompt) {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      if (choice.outcome === 'accepted') {
        setInstalled(true)
        setInstallPrompt(null)
      }
    } else {
      setShowHint(!showHint)
    }
  }

  // v4.43: Hard block — return null on mobile (not even rendered)
  if (!isDesktop) return null
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
