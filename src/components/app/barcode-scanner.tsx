'use client'

/**
 * Barcode Scanner Component (v4.67)
 * ==================================
 * Uses the browser's BarcodeDetector API (Chrome/Edge) or
 * camera + ZXing fallback to scan barcodes.
 *
 * Usage in Sale/Purchase:
 *   <BarcodeScanner onScan={(code) => handleScan(code)} />
 *
 * When user clicks "Scan Barcode":
 *   1. Opens camera (requires HTTPS + camera permission)
 *   2. Detects barcode (EAN-13, UPC-A, Code-128, QR, etc.)
 *   3. Calls onScan with the detected code
 *   4. Auto-fills the item name/SKU field
 */

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScanLine, X, Loader2, Camera } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface BarcodeScannerProps {
  onScan: (code: string) => void
  buttonText?: string
}

export function BarcodeScanner({ onScan, buttonText = 'Scan Barcode' }: BarcodeScannerProps) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationRef = useRef<number | null>(null)

  const startScanning = async () => {
    setError('')
    setScanning(true)

    try {
      // Check if BarcodeDetector is available (Chrome 83+)
      const hasBarcodeDetector = 'BarcodeDetector' in window

      // Request camera access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' } // back camera
      })
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
      }

      if (hasBarcodeDetector) {
        // Use native BarcodeDetector API
        // @ts-ignore - BarcodeDetector is not in TS types yet
        const detector = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'data_matrix']
        })

        const detectLoop = async () => {
          if (!videoRef.current || !open) return

          try {
            const barcodes = await detector.detect(videoRef.current)
            if (barcodes.length > 0) {
              const code = barcodes[0].rawValue
              handleDetected(code)
              return
            }
          } catch (e) {
            // Detection error — continue
          }

          animationRef.current = requestAnimationFrame(detectLoop)
        }
        detectLoop()
      } else {
        // Fallback: manual entry (BarcodeDetector not supported)
        setError('Barcode scanning is not supported on this browser. Please enter the barcode manually.')
        setScanning(false)
      }
    } catch (err: any) {
      console.error('[BARCODE] Camera error:', err)
      setError(err?.message || 'Could not access camera. Please check permissions.')
      setScanning(false)
    }
  }

  const handleDetected = (code: string) => {
    console.log('[BARCODE] Detected:', code)
    stopScanning()
    setOpen(false)
    onScan(code)
    toast({ title: 'Barcode Scanned', description: code, duration: 3000 })
  }

  const stopScanning = () => {
    setScanning(false)
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }

  const handleClose = () => {
    stopScanning()
    setOpen(false)
    setError('')
  }

  useEffect(() => {
    return () => stopScanning()
  }, [])

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5 text-xs"
      >
        <ScanLine className="h-3.5 w-3.5" />
        {buttonText}
      </Button>

      <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScanLine className="h-5 w-5 text-emerald-600" />
              Barcode Scanner
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {error && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
                {error}
                <input
                  type="text"
                  placeholder="Enter barcode manually..."
                  className="w-full mt-2 px-2 py-1.5 border rounded text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleDetected((e.target as HTMLInputElement).value)
                    }
                  }}
                />
              </div>
            )}

            {!error && (
              <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  playsInline
                  muted
                />
                {/* Scanning overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-3/4 h-1 bg-emerald-500/70 animate-pulse" />
                </div>
                {scanning && (
                  <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Scanning...
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              {!scanning && !error && (
                <Button onClick={startScanning} className="bg-emerald-600 hover:bg-emerald-700 flex-1">
                  <Camera className="h-4 w-4 mr-2" />
                  Start Camera
                </Button>
              )}
              <Button variant="outline" onClick={handleClose} className="flex-1">
                Close
              </Button>
            </div>

            <p className="text-[11px] text-muted-foreground text-center">
              Point your camera at a barcode (EAN, UPC, Code-128, QR). Works best with good lighting.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
