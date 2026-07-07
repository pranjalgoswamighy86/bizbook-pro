'use client'

/**
 * Download for Desktop — v6.14.3
 * Uses createPortal to render modals on document.body,
 * escaping the top bar's sticky stacking context.
 */

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
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
  const [showGuide, setShowGuide] = useState(false)
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null)
  const [platform, setPlatform] = useState<Platform>('unknown')
  const [isDesktop, setIsDesktop] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  // Scroll modal to top when it opens
  useEffect(() => {
    if (showModal) {
      // Use setTimeout to ensure the modal is rendered before scrolling
      const timer = setTimeout(() => {
        if (modalRef.current) {
          modalRef.current.scrollTop = 0
        }
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [showModal])

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
    // v6.13: Show installation guide first, then proceed to download
    setSelectedPlatform(plat)
    setShowGuide(true)
  }

  const handleProceedToDownload = () => {
    if (!selectedPlatform) return
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
    if (selectedPlatform === 'linux') {
      window.open(`${baseUrl}/api/desktop-download?platform=linux`, '_blank')
    } else {
      // Windows .exe and Mac .dmg are hosted on GitHub Releases
      window.open('https://github.com/pranjalgoswamighy86/bizbook-pro/releases/latest', '_blank')
    }
    setShowGuide(false)
    setShowModal(false)
    setSelectedPlatform(null)
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

      {showModal && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 p-4"
          style={{ zIndex: 9998 }}
          onClick={() => setShowModal(false)}
        >
          <div
            ref={modalRef}
            className="bg-card border-2 border-emerald-500 rounded-xl shadow-2xl max-w-lg w-full p-6 relative mx-auto my-auto max-h-[85vh] overflow-y-auto"
            style={{ zIndex: 9999, position: 'relative' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-3 right-3 text-muted-foreground hover:text-foreground z-10"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="text-lg font-bold mb-1">Download BizBook Pro Desktop</h2>
            <p className="text-xs text-muted-foreground mb-3">
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
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-colors text-left bg-white dark:bg-zinc-900 ${
                      isRecommended
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
                        : 'border-gray-300 dark:border-zinc-700 hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20'
                    }`}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{info.label}</span>
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
        </div>,
        document.body
      )}
      {showGuide && selectedPlatform && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/60 p-4 overflow-y-auto"
          style={{ zIndex: 9999 }}
          onClick={() => { setShowGuide(false); setSelectedPlatform(null) }}
        >
          <div
            className="bg-card border-2 border-emerald-500 rounded-xl shadow-2xl max-w-2xl w-full p-6 relative mt-8 mb-8 mx-auto"
            style={{ zIndex: 10000, position: 'relative' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { setShowGuide(false); setSelectedPlatform(null) }}
              className="absolute top-3 right-3 text-muted-foreground hover:text-foreground z-10"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="text-lg font-bold mb-2 flex items-center gap-2">
              <Download className="h-5 w-5 text-emerald-600" />
              Installation Guide — {PLATFORM_INFO[selectedPlatform].label}
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              Please read these instructions carefully before downloading. Scroll down to proceed.
            </p>

            {/* Installation Guide Content */}
            <div className="prose prose-sm max-w-none text-sm space-y-3 mb-6">
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-3">
                <p className="font-bold text-amber-800 dark:text-amber-200 text-xs uppercase tracking-wide mb-1">⚠️ Important: Unblock Before Running</p>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Windows blocks downloaded .exe files by default. You MUST unblock the file before running it:
                </p>
                <ol className="text-xs text-amber-700 dark:text-amber-300 list-decimal list-inside mt-1 space-y-0.5">
                  <li>Right-click the downloaded .exe file</li>
                  <li>Click <strong>Properties</strong></li>
                  <li>Check the <strong>"Unblock"</strong> checkbox at the bottom</li>
                  <li>Click <strong>Apply</strong> → <strong>OK</strong></li>
                </ol>
              </div>

              <div>
                <h3 className="font-bold text-sm mb-1">Step 1: Download</h3>
                <p className="text-xs text-muted-foreground">Click the "Proceed to Download" button at the bottom of this guide. You'll be taken to GitHub Releases. Download the {PLATFORM_INFO[selectedPlatform].ext} file for your platform.</p>
              </div>

              <div>
                <h3 className="font-bold text-sm mb-1">Step 2: Unblock & Install</h3>
                <p className="text-xs text-muted-foreground">
                  Unblock the file (see yellow box above), then double-click to run. If SmartScreen appears, click <strong>"More info"</strong> → <strong>"Run anyway"</strong>. Follow the setup wizard.
                </p>
              </div>

              <div>
                <h3 className="font-bold text-sm mb-1">Step 3: Launch & Log In</h3>
                <p className="text-xs text-muted-foreground">
                  Find "BizBook Pro" in your Start Menu. Launch it and log in with your existing email and password.
                </p>
              </div>

              <div>
                <h3 className="font-bold text-sm mb-1">Step 4: Printer Setup</h3>
                <p className="text-xs text-muted-foreground">
                  For thermal printers: Set your printer as the default in Windows Settings. In BizBook Pro, go to any Sale → click Print → select your thermal printer → change paper size to 58mm (or Roll Paper) → click Print.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  For A4 printers: Just click Print — the layout adapts automatically.
                </p>
              </div>

              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg p-3">
                <p className="font-bold text-blue-800 dark:text-blue-200 text-xs uppercase tracking-wide mb-1">💡 Did You Know?</p>
                <ul className="text-xs text-blue-700 dark:text-blue-300 list-disc list-inside space-y-0.5">
                  <li>Your data is synced with the cloud — no data loss on reinstall</li>
                  <li>The desktop app updates automatically when we push new features</li>
                  <li>Press F1 inside the app for AI Support Chat</li>
                </ul>
              </div>
            </div>

            {/* Proceed to Download Button */}
            <div className="border-t pt-4 flex flex-col items-center gap-2">
              <button
                onClick={handleProceedToDownload}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-lg flex items-center justify-center gap-2 transition-colors text-sm"
              >
                <Download className="h-4 w-4" />
                Proceed to Download — {PLATFORM_INFO[selectedPlatform].label} ({PLATFORM_INFO[selectedPlatform].ext})
              </button>
              <button
                onClick={() => { setShowGuide(false); setSelectedPlatform(null) }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
