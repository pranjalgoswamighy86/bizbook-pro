'use client'

/**
 * Download for Desktop — v5.1 COMPLETE REWRITE
 * =================================================
 * Old version (v4.43) showed a PWA install hint modal. User explicitly
 * requested this button offer the actual .exe / .AppImage / .dmg installer
 * files for the Electron desktop app.
 *
 * New behavior:
 * - Button opens a dropdown modal with platform options
 * - Each platform links to its installer download URL
 * - Auto-detects user's OS from navigator.userAgent
 * - Also offers "Install as PWA" as a secondary option
 *
 * Installer hosting:
 * - Linux AppImage is built and hosted at /api/desktop-download?platform=linux
 * - Windows .exe and Mac .dmg are built via GitHub Actions and hosted on
 *   GitHub Releases — the button links to the releases page
 */

import { useState, useEffect } from 'react'
import { Download, Monitor, Apple, Terminal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type Platform = 'windows' | 'mac' | 'linux' | 'unknown'

function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'unknown'
  const ua = window.navigator.userAgent.toLowerCase()
  if (ua.includes('win')) return 'windows'
  if (ua.includes('mac')) return 'mac'
  if (ua.includes('linux')) return 'linux'
  return 'unknown'
}

const PLATFORM_INFO = {
  windows: {
    label: 'Windows',
    icon: Monitor,
    ext: '.exe',
    size: '~380 MB',
    note: 'Windows 10/11 (64-bit)',
  },
  mac: {
    label: 'macOS',
    icon: Apple,
    ext: '.dmg',
    size: '~380 MB',
    note: 'macOS 11+ (Intel & Apple Silicon)',
  },
  linux: {
    label: 'Linux',
    icon: Terminal,
    ext: '.AppImage',
    size: '380 MB',
    note: 'Ubuntu/Debian/Fedora (x64)',
  },
}

export function DownloadForDesktop() {
  const [showModal, setShowModal] = useState(false)
  const [platform, setPlatform] = useState<Platform>('unknown')
  const [isDesktop, setIsDesktop] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const checkDesktop = () => setIsDesktop(window.innerWidth >= 900)
    checkDesktop()
    window.addEventListener('resize', checkDesktop)
    return () => window.removeEventListener('resize', checkDesktop)
  }, [])

  useEffect(() => {
    if (!isDesktop) return
    setPlatform(detectPlatform())

    const handler = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [isDesktop])

  // Hard block on mobile
  if (!isDesktop) return null

  const handleDownload = (plat: Platform) => {
    // Route to the download API which serves the installer file
    // For Windows/Mac, redirect to GitHub Releases (built via CI)
    // For Linux, serve the AppImage from the server
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
    if (plat === 'linux') {
      // Linux AppImage is served directly from the server
      window.open(`${baseUrl}/api/desktop-download?platform=linux`, '_blank')
    } else {
      // Windows .exe and Mac .dmg are hosted on GitHub Releases
      window.open('https://github.com/pranjalgoswamighy86/bizbook-pro/releases/latest', '_blank')
    }
    setShowModal(false)
  }

  const handlePWAInstall = async () => {
    if (installPrompt) {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      if (choice.outcome === 'accepted') {
        setShowModal(false)
      }
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowModal(true)}
        className="gap-2 text-xs border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300"
        title="Download BizBook Pro desktop app"
      >
        <Download className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Download Desktop</span>
        <span className="sm:hidden">Desktop</span>
      </Button>

      {showModal && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-card border rounded-xl shadow-2xl max-w-lg w-full p-6 relative max-h-[calc(100vh-4rem)] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-3 right-3 text-muted-foreground hover:text-foreground z-10"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="text-xl font-bold mb-1">Download BizBook Pro Desktop</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Install the native desktop app for silent thermal printing, fingerprint scanner support, and offline access.
            </p>

            {/* Platform download buttons */}
            <div className="space-y-2 mb-4">
              {(Object.keys(PLATFORM_INFO) as Platform[]).map((plat) => {
                const info = PLATFORM_INFO[plat]
                const Icon = info.icon
                const isRecommended = plat === platform
                return (
                  <button
                    key={plat}
                    onClick={() => handleDownload(plat)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-colors text-left ${
                      isRecommended
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
                        : 'border-border hover:border-emerald-300 hover:bg-accent'
                    }`}
                  >
                    <Icon className="h-6 w-6 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{info.label}</span>
                        <span className="text-xs text-muted-foreground">{info.ext}</span>
                        {isRecommended && (
                          <span className="text-[10px] bg-emerald-600 text-white px-1.5 py-0.5 rounded-full font-bold">
                            RECOMMENDED
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {info.note} · {info.size}
                      </div>
                    </div>
                    <Download className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                  </button>
                )
              })}
            </div>

            {/* PWA install option (secondary) */}
            {installPrompt && (
              <div className="border-t pt-3">
                <button
                  onClick={handlePWAInstall}
                  className="w-full text-sm text-muted-foreground hover:text-foreground underline"
                >
                  Or install as a lightweight PWA (browser-based, no download)
                </button>
              </div>
            )}

            <div className="mt-4 pt-3 border-t text-xs text-muted-foreground">
              <p className="mb-1"><strong>Why the desktop app?</strong></p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Silent thermal printer support (no print dialog)</li>
                <li>USB fingerprint scanner integration</li>
                <li>Offline mode with auto-sync</li>
                <li>Auto-detects thermal vs A4 printer</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
