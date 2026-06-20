'use client'

/**
 * UPI Checkout Modal — v4.47 (Screenshot + UTR Proof)
 * ====================================================
 * USER FLOW:
 *   1. User opens modal → QR code + amount shown
 *   2. User pays via UPI app (iPhone/Android)
 *   3. User takes screenshot of UPI success screen (shows UTR + amount)
 *   4. User uploads screenshot + enters UTR number
 *   5. Backend stores proof, status: PENDING → PROOF_SUBMITTED
 *   6. Admin reviews in Super Admin Panel
 *   7. Admin approves → plan activates
 *   8. User's modal auto-detects SUCCESS via polling → closes
 *
 * v4.47 also supports:
 *   - SMS webhook (Android only, instant) — if SMS_WEBHOOK_SECRET set
 *   - IMAP email scraper (any phone, 2-5 min delay) — if AUTO_ALERT_EMAIL_* set
 *   - Screenshot + UTR manual proof (any phone, admin review) — ALWAYS available
 */

import { useState, useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, AlertTriangle, Copy, ShieldCheck, Clock, InfoIcon, Upload, ImageIcon, X } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/lib/auth-fetch'

interface UPICheckoutModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  tenantId: string
  planHours: number
  planName: string
}

export function UPICheckoutModal({ open, onClose, onSuccess, tenantId, planHours, planName }: UPICheckoutModalProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [checkout, setCheckout] = useState<any>(null)
  const [status, setStatus] = useState<'idle' | 'initiating' | 'waiting' | 'success' | 'expired' | 'error' | 'proof_submitted'>('idle')
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [imapEnabled, setImapEnabled] = useState<boolean | null>(null)
  const [smsWebhookEnabled, setSmsWebhookEnabled] = useState<boolean | null>(null)
  const [autoVerifyEnabled, setAutoVerifyEnabled] = useState<boolean | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null)

  // v4.47: Proof submission state
  const [showProofForm, setShowProofForm] = useState(false)
  const [utrNumber, setUtrNumber] = useState('')
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null)
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const elapsedRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const startedAtRef = useRef<number>(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open || !tenantId) return
    initiate()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (elapsedRef.current) clearInterval(elapsedRef.current)
    }
  }, [open])

  const initiate = async () => {
    setStatus('initiating'); setLoading(true)
    startedAtRef.current = Date.now()
    setElapsedSec(0)
    setVerifyMessage(null)
    setShowProofForm(false)
    setUtrNumber('')
    setScreenshotFile(null)
    setScreenshotPreview(null)
    try {
      const res = await authFetch('/api/upi-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'initiate', tenantId, planHours }) })
      const data = await res.json()
      if (!res.ok) { setStatus('error'); return }
      setCheckout(data); setStatus('waiting'); startPolling(data.queueId)
      elapsedRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000))
      }, 1000)
    } catch { setStatus('error') } finally { setLoading(false) }
  }

  const startPolling = (qid: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    let pollCount = 0
    pollRef.current = setInterval(async () => {
      pollCount++
      try {
        const res = await authFetch('/api/upi-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check-status', tenantId, queueId: qid }) })
        const data = await res.json()
        setLastChecked(new Date())
        if (data.imapEnabled === false) setImapEnabled(false)
        else if (data.imapEnabled === true) setImapEnabled(true)
        if (data.smsWebhookEnabled === false) setSmsWebhookEnabled(false)
        else if (data.smsWebhookEnabled === true) setSmsWebhookEnabled(true)
        if (data.autoVerifyEnabled === false) setAutoVerifyEnabled(false)
        else if (data.autoVerifyEnabled === true) setAutoVerifyEnabled(true)

        if (data.status === 'SUCCESS') {
          setStatus('success')
          if (pollRef.current) clearInterval(pollRef.current)
          if (elapsedRef.current) clearInterval(elapsedRef.current)
          toast({ title: '✅ Payment Verified!', description: `${planName} activated!`, duration: 6000 })
          setTimeout(() => { onSuccess(); onClose() }, 2000)
        } else if (data.status === 'PROOF_SUBMITTED') {
          setStatus('proof_submitted')
        }
        if (pollCount === 24 && pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = setInterval(async () => {
            try {
              const r2 = await authFetch('/api/upi-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check-status', tenantId, queueId: qid }) })
              const d2 = await r2.json()
              setLastChecked(new Date())
              if (d2.status === 'SUCCESS') {
                setStatus('success')
                if (pollRef.current) clearInterval(pollRef.current)
                if (elapsedRef.current) clearInterval(elapsedRef.current)
                toast({ title: '✅ Payment Verified!', description: `${planName} activated!`, duration: 6000 })
                setTimeout(() => { onSuccess(); onClose() }, 2000)
              } else if (d2.status === 'PROOF_SUBMITTED') {
                setStatus('proof_submitted')
              }
            } catch {}
          }, 15000)
        }
      } catch {}
    }, 5000)
  }

  // v4.47: "I've Paid — Check Status" button (auto-verify attempt)
  const handleManualVerify = async () => {
    if (!checkout?.queueId) return
    setVerifying(true)
    setVerifyMessage(null)
    try {
      const res = await authFetch('/api/upi-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify-payment', tenantId, queueId: checkout.queueId }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setStatus('success')
        if (pollRef.current) clearInterval(pollRef.current)
        if (elapsedRef.current) clearInterval(elapsedRef.current)
        toast({ title: '✅ Payment Verified!', description: `${planName} activated!`, duration: 6000 })
        setTimeout(() => { onSuccess(); onClose() }, 2000)
      } else if (res.status === 401) {
        setVerifyMessage('Your login session expired. Please log in again.')
        toast({ title: 'Session Expired', description: 'Please log in again.', variant: 'destructive', duration: 10000 })
      } else if (data.status === 'auto_verify_not_configured' || data.status === 'imap_not_configured') {
        setVerifyMessage('Auto-verification is not available. Please submit payment proof (screenshot + UTR) using the button below.')
        toast({ title: 'Auto-Verify Unavailable', description: 'Submit proof below.', variant: 'default', duration: 10000 })
      } else if (data.status === 'payment_not_detected') {
        setVerifyMessage('Payment not detected automatically. Please submit payment proof (screenshot + UTR) using the button below for admin review.')
        toast({ title: 'Payment Not Detected', description: 'Submit proof below.', variant: 'default', duration: 10000 })
      } else {
        setVerifyMessage(data.error || 'Could not verify payment.')
        toast({ title: 'Verification Issue', description: data.error || 'Please try again.', variant: 'destructive', duration: 8000 })
      }
    } catch (err: any) {
      setVerifyMessage('Network error. Please try again.')
      toast({ title: 'Network Error', description: err.message || 'Network error.', variant: 'destructive' })
    } finally {
      setVerifying(false)
    }
  }

  // v4.47: File selection handler
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Max 5MB.', variant: 'destructive' })
      return
    }
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
    if (!allowedTypes.includes(file.type)) {
      toast({ title: 'Invalid file type', description: 'Allowed: JPG, PNG, WEBP, PDF', variant: 'destructive' })
      return
    }
    setScreenshotFile(file)
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = (ev) => setScreenshotPreview(ev.target?.result as string)
      reader.readAsDataURL(file)
    } else {
      setScreenshotPreview(null) // PDF — no preview
    }
  }

  // v4.47: Submit payment proof (screenshot + UTR)
  const handleSubmitProof = async () => {
    if (!checkout?.queueId) return
    if (!utrNumber.trim()) {
      toast({ title: 'UTR required', description: 'Enter the 12-digit UTR from your UPI app.', variant: 'destructive' })
      return
    }
    if (!screenshotFile) {
      toast({ title: 'Screenshot required', description: 'Upload a screenshot of your payment success screen.', variant: 'destructive' })
      return
    }
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('queueId', checkout.queueId)
      formData.append('utrNumber', utrNumber.trim())
      formData.append('screenshot', screenshotFile)

      const res = await authFetch('/api/payment-proof', {
        method: 'POST',
        body: formData, // No Content-Type header — browser sets it with boundary
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setStatus('proof_submitted')
        toast({
          title: '✅ Proof Submitted!',
          description: 'Admin will review your payment. You will be notified when activated.',
          duration: 8000,
        })
        // Continue polling for admin approval
      } else {
        toast({ title: 'Submission Failed', description: data.error || 'Please try again.', variant: 'destructive', duration: 8000 })
      }
    } catch (err: any) {
      toast({ title: 'Upload Error', description: err.message || 'Network error.', variant: 'destructive' })
    } finally {
      setUploading(false)
    }
  }

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const remainingSec = Math.max(0, 30 * 60 - elapsedSec)

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (!v) {
        if (pollRef.current) clearInterval(pollRef.current)
        if (elapsedRef.current) clearInterval(elapsedRef.current)
        onClose()
      }
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center">
            {status === 'success' ? 'Payment Successful!' :
             status === 'proof_submitted' ? 'Proof Submitted — Awaiting Review' :
             'UPI Payment'}
          </DialogTitle>
        </DialogHeader>

        {(status === 'initiating' || loading) && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-10 w-10 animate-spin text-emerald-600" />
            <p className="text-sm text-muted-foreground">Generating QR...</p>
          </div>
        )}

        {status === 'waiting' && checkout && (
          <div className="space-y-3">
            <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border text-center">
              <span className="text-xs text-slate-400 block">Pay Exactly</span>
              <span className="text-2xl font-black text-emerald-600">₹{checkout.finalAmount.toFixed(2)}</span>
            </div>

            <div className="flex justify-center p-3 bg-white border rounded-2xl mx-auto w-fit">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(checkout.upiUri)}&bgcolor=ffffff&color=000000&ecc=H`}
                alt="UPI QR"
                className="w-44 h-44"
              />
            </div>

            <p className="text-xs text-slate-500 text-center">
              Pay to: <strong>{checkout.payeeVPA}</strong>
            </p>

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                navigator.clipboard.writeText(checkout.upiUri)
                toast({ title: 'UPI Link Copied!' })
              }}
            >
              <Copy className="h-3 w-3 mr-1.5" />Copy UPI Link
            </Button>

            <div className="text-[11px] font-semibold text-amber-700 bg-amber-50 p-2.5 rounded-xl border border-amber-200 text-left">
              ⚠️ Pay the <strong>exact amount</strong> (₹{checkout.finalAmount.toFixed(2)}) including paise. Rounding off breaks auto-verification.
            </div>

            <div className="flex items-center justify-between text-xs text-slate-500 px-1">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Elapsed: <strong>{formatElapsed(elapsedSec)}</strong> / 30:00
              </span>
              {lastChecked && (
                <span>Last checked: {lastChecked.toLocaleTimeString()}</span>
              )}
            </div>

            {autoVerifyEnabled === true && (
              <div className="text-[11px] text-emerald-700 bg-emerald-50 p-2.5 rounded-xl border border-emerald-200 text-left flex gap-2">
                <InfoIcon className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span>✅ <strong>Auto-verification is ON.</strong> After paying, your plan will activate automatically (within 30s via SMS or 2-5 min via email). If not auto-verified, submit proof below.</span>
              </div>
            )}
            {autoVerifyEnabled === false && (
              <div className="text-[11px] text-blue-700 bg-blue-50 p-2.5 rounded-xl border border-blue-200 text-left flex gap-2">
                <InfoIcon className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span>💡 <strong>Auto-verification is OFF.</strong> After paying, click "I've Paid — Check Status" below. If still not verified, submit payment proof (screenshot + UTR) for admin review.</span>
              </div>
            )}

            <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              {autoVerifyEnabled === true
                ? 'Auto-verifying... (payment detected instantly)'
                : 'Click below after paying to check status'}
            </div>

            {/* v4.45: "I've Paid — Check Status" button (auto-verify only) */}
            <Button
              onClick={handleManualVerify}
              disabled={verifying}
              className="w-full"
              variant="outline"
            >
              {verifying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Checking payment status...
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4 mr-2" />
                  I've Paid — Check Status
                </>
              )}
            </Button>

            {/* v4.47: "Submit Payment Proof" button — opens proof form */}
            <Button
              onClick={() => setShowProofForm(!showProofForm)}
              className="w-full bg-emerald-600 hover:bg-emerald-700"
              variant="default"
            >
              <Upload className="h-4 w-4 mr-2" />
              {showProofForm ? 'Hide Proof Form' : 'Submit Payment Proof (Screenshot + UTR)'}
            </Button>

            {/* v4.47: Payment proof submission form */}
            {showProofForm && (
              <div className="space-y-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    UTR Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={utrNumber}
                    onChange={(e) => setUtrNumber(e.target.value)}
                    placeholder="12-digit UTR (e.g., 403521786543)"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500"
                    maxLength={22}
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Find UTR in your UPI app → Transaction Details → "UPI Ref No" or "Transaction ID"
                  </p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Payment Screenshot <span className="text-red-500">*</span>
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImageIcon className="h-4 w-4 mr-2" />
                    {screenshotFile ? `✓ ${screenshotFile.name}` : 'Choose Screenshot'}
                  </Button>
                  {screenshotPreview && (
                    <div className="mt-2 relative">
                      <img src={screenshotPreview} alt="Screenshot preview" className="w-full max-h-40 object-contain rounded-lg border" />
                      <button
                        onClick={() => { setScreenshotFile(null); setScreenshotPreview(null) }}
                        className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                        aria-label="Remove screenshot"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] text-slate-500 mt-1">
                    Take screenshot of UPI success screen showing UTR + amount + date. Max 5MB. JPG/PNG/WEBP/PDF.
                  </p>
                </div>

                <Button
                  onClick={handleSubmitProof}
                  disabled={uploading || !utrNumber || !screenshotFile}
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Submitting proof...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="h-4 w-4 mr-2" />
                      Submit Proof for Admin Review
                    </>
                  )}
                </Button>
              </div>
            )}

            {verifyMessage && (
              <div className="text-[11px] text-amber-700 bg-amber-50 p-2.5 rounded-xl border border-amber-200 text-left">
                {verifyMessage}
              </div>
            )}

            <p className="text-[10px] text-center text-slate-400">
              Time remaining: {formatElapsed(remainingSec)}
            </p>
          </div>
        )}

        {/* v4.47: Proof submitted — waiting for admin review */}
        {status === 'proof_submitted' && (
          <div className="space-y-3 py-4">
            <div className="flex flex-col items-center gap-3">
              <div className="h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center">
                <Clock className="h-8 w-8 text-amber-600" />
              </div>
              <p className="text-base font-bold text-amber-700 text-center">Awaiting Admin Review</p>
              <p className="text-sm text-muted-foreground text-center">
                Your payment proof has been submitted. An admin will review it shortly.
                This page will auto-update when your plan is activated.
              </p>
            </div>
            <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-xl border text-left">
              <p className="font-semibold mb-1">What happens next:</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Admin opens Super Admin Panel</li>
                <li>Admin views your screenshot + UTR</li>
                <li>Admin verifies UTR in bank statement</li>
                <li>Admin clicks "Approve" → plan activates</li>
                <li>This modal auto-closes with ✅ success</li>
              </ol>
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              Checking for admin approval... (every 15s)
            </div>
          </div>
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 className="h-16 w-16 text-emerald-600" />
            <p className="text-lg font-bold text-emerald-700">Activated!</p>
            <p className="text-sm text-muted-foreground">{planName} is now active.</p>
          </div>
        )}

        {status === 'expired' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <AlertTriangle className="h-12 w-12 text-amber-500" />
            <p className="text-sm text-muted-foreground text-center">
              The payment session expired after 30 minutes.<br/>
              If you paid, please contact support with your UTR number.
            </p>
            <Button variant="outline" size="sm" onClick={initiate}>Generate New QR</Button>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <AlertTriangle className="h-12 w-12 text-red-500" />
            <p className="text-sm text-muted-foreground">Could not initiate payment. Please try again.</p>
            <Button variant="outline" size="sm" onClick={initiate}>Retry</Button>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (pollRef.current) clearInterval(pollRef.current)
              if (elapsedRef.current) clearInterval(elapsedRef.current)
              onClose()
            }}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
