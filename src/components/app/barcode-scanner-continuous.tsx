'use client'

/**
 * BarcodeScannerContinuous Component (v4.80)
 * ============================================
 * A continuous barcode scanner that:
 *   1. Auto-starts the camera when opened (no need to click "Start Camera")
 *   2. Continuously scans for barcodes without requiring additional clicks
 *   3. Adds each scanned item automatically to the items list
 *   4. Stays open so the user can scan multiple items in sequence
 *   5. Shows a live feed of scanned codes with timestamps
 *   6. Plays a beep sound on each successful scan
 *
 * Position: This component should be placed AFTER the items section
 * (below the "Add Item" button), NOT next to each item name field.
 *
 * Usage:
 *   <BarcodeScannerContinuous
 *     onScan={(code) => handleScan(code)}
 *     alreadyScanned={scannedCodes}
 *   />
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScanLine, X, Loader2, Camera, Check, Package } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface ScannedItem {
  code: string
  timestamp: Date
}

interface BarcodeScannerContinuousProps {
  /** Called every time a new barcode is detected */
  onScan: (code: string) => void
  /** Button text for the trigger button */
  buttonText?: string
  /** Already-scanned codes to avoid duplicate scans within 3 seconds */
  recentlyScanned?: string[]
}

export function BarcodeScannerContinuous({
  onScan,
  buttonText = 'Scan Barcodes',
  recentlyScanned = [],
}: BarcodeScannerContinuousProps) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([])
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationRef = useRef<number | null>(null)
  const lastScanRef = useRef<{ code: string; time: number }>({ code: '', time: 0 })
  const detectorRef = useRef<any>(null)

  // Play a beep sound on successful scan
  const playBeep = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      const oscillator = ctx.createOscillator()
      const gainNode = ctx.createGain()
      oscillator.connect(gainNode)
      gainNode.connect(ctx.destination)
      oscillator.frequency.value = 880
      gainNode.gain.value = 0.3
      oscillator.start(ctx.currentTime)
      oscillator.stop(ctx.currentTime + 0.1)
    } catch {
      // Audio not available
    }
  }, [])

  const handleDetected = useCallback((code: string) => {
    const now = Date.now()
    // Debounce: ignore same code within 3 seconds
    if (code === lastScanRef.current.code && now - lastScanRef.current.time < 3000) {
      return
    }
    // Also check recentlyScanned prop (codes already in the items list)
    if (recentlyScanned.includes(code) && now - lastScanRef.current.time < 3000) {
      return
    }

    lastScanRef.current = { code, time: now }
    playBeep()

    const scannedItem: ScannedItem = { code, timestamp: new Date() }
    setScannedItems(prev => [scannedItem, ...prev].slice(0, 20)) // Keep last 20 scans

    onScan(code)
    toast({
      title: '✅ Barcode Scanned',
      description: code,
      duration: 2000,
    })
  }, [onScan, playBeep, recentlyScanned, toast])

  // Auto-start scanning when dialog opens
  const startScanning = useCallback(async () => {
    setError('')
    setScanning(true)

    try {
      const hasBarcodeDetector = 'BarcodeDetector' in window

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
      }

      if (hasBarcodeDetector) {
        // @ts-ignore - BarcodeDetector is not in TS types yet
        detectorRef.current = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'data_matrix'],
        })

        const detectLoop = async () => {
          if (!videoRef.current || !open) return

          try {
            const barcodes = await detectorRef.current.detect(videoRef.current)
            if (barcodes.length > 0) {
              const code = barcodes[0].rawValue
              handleDetected(code)
              // Do NOT return — continue scanning for more barcodes
            }
          } catch {
            // Detection error — continue
          }

          animationRef.current = requestAnimationFrame(detectLoop)
        }
        detectLoop()
      } else {
        setError('Barcode scanning is not supported on this browser. Please use Chrome or Edge, or enter barcodes manually.')
        setScanning(false)
      }
    } catch (err: any) {
      console.error('[BARCODE] Camera error:', err)
      setError(err?.message || 'Could not access camera. Please check permissions.')
      setScanning(false)
    }
  }, [open, handleDetected])

  const stopScanning = useCallback(() => {
    setScanning(false)
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  const handleOpen = () => {
    setScannedItems([])
    setOpen(true)
  }

  const handleClose = () => {
    stopScanning()
    setOpen(false)
    setError('')
    setScannedItems([])
  }

  // Auto-start scanning when dialog opens (no need to click "Start Camera")
  useEffect(() => {
    if (open && !scanning && !error) {
      // Small delay to let the video element mount
      const timer = setTimeout(() => startScanning(), 300)
      return () => clearTimeout(timer)
    }
  }, [open, scanning, error, startScanning])

  // Cleanup on unmount
  useEffect(() => {
    return () => stopScanning()
  }, [stopScanning])

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={handleOpen}
        className="gap-2 text-sm h-10 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
        title="Open barcode scanner — continuously scans and adds items automatically"
      >
        <ScanLine className="h-5 w-5" />
        {buttonText}
      </Button>

      <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ScanLine className="h-5 w-5 text-emerald-600" />
              Barcode Scanner — Continuous Mode
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {error && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
                {error}
                <input
                  type="text"
                  placeholder="Enter barcode manually and press Enter..."
                  className="w-full mt-2 px-3 py-2 border rounded text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const value = (e.target as HTMLInputElement).value.trim()
                      if (value) handleDetected(value)
                      ;(e.target as HTMLInputElement).value = ''
                    }
                  }}
                  autoFocus
                />
              </div>
            )}

            {!error && (
              <>
                {/* Camera feed */}
                <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                  <video
                    ref={videoRef}
                    className="w-full h-full object-cover"
                    playsInline
                    muted
                  />
                  {/* Scanning overlay — green line */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-3/4 h-1 bg-emerald-500/70 animate-pulse" />
                  </div>
                  {scanning && (
                    <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Auto-scanning... Point at barcode
                    </div>
                  )}
                  {scannedItems.length > 0 && (
                    <div className="absolute top-2 right-2 bg-emerald-600 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                      <Check className="h-3 w-3" />
                      {scannedItems.length} scanned
                    </div>
                  )}
                </div>

                {/* Scanned items list */}
                {scannedItems.length > 0 && (
                  <div className="max-h-32 overflow-y-auto border rounded-lg">
                    {scannedItems.map((item, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs border-b last:border-0 bg-emerald-50/50">
                        <span className="flex items-center gap-2">
                          <Package className="h-3 w-3 text-emerald-600" />
                          <span className="font-mono font-medium">{item.code}</span>
                        </span>
                        <span className="text-muted-foreground">
                          {item.timestamp.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Instructions */}
                <p className="text-xs text-muted-foreground text-center">
                  {scanning
                    ? '📸 Camera is active. Point at barcodes — items will be added automatically.'
                    : 'Starting camera...'
                  }
                </p>
              </>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose} className="flex-1">
                <X className="h-4 w-4 mr-1" />
                Done ({scannedItems.length})
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
