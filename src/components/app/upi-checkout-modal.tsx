'use client'

/**
 * UPI Checkout Modal — Zero-Cost Autonomous Payment
 * ==================================================
 * v4.43: Added "I've Paid — Verify Now" button (manual verify fallback)
 *        Better error handling for 401/session expired
 *        Auto-poll every 5s for first 2 min, then every 15s
 */

import { useState, useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, AlertTriangle, Copy, ShieldCheck, Clock } from 'lucide-react'
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
  const [status, setStatus] = useState<'idle' | 'initiating' | 'waiting' | 'success' | 'expired' | 'error'>('idle')
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [imapEnabled, setImapEnabled] = useState<boolean | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const elapsedRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const startedAtRef = useRef<number>(0)

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

        if (data.status === 'SUCCESS') {
          setStatus('success')
          if (pollRef.current) clearInterval(pollRef.current)
          if (elapsedRef.current) clearInterval(elapsedRef.current)
          toast({ title: '✅ Payment Verified!', description: `${planName} activated!`, duration: 6000 })
          setTimeout(() => { onSuccess(); onClose() }, 2000)
        } else if (data.status === 'EXPIRED' && data.canManualVerify === false) {
          setStatus('expired')
          if (pollRef.current) clearInterval(pollRef.current)
          if (elapsedRef.current) clearInterval(elapsedRef.current)
        }
        // After 2 minutes of polling (24 polls × 5s = 120s), slow down to every 15s
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
              }
            } catch {}
          }, 15000)
        }
      } catch {}
    }, 5000)
  }

  const handleManualVerify = async () => {
    if (!checkout?.queueId) return
    setVerifying(true)
    try {
      const res = await authFetch('/api/upi-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'admin-verify', tenantId, queueId: checkout.queueId }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setStatus('success')
        if (pollRef.current) clearInterval(pollRef.current)
        if (elapsedRef.current) clearInterval(elapsedRef.current)
        toast({ title: '✅ Payment Verified!', description: `${planName} activated!`, duration: 6000 })
        setTimeout(() => { onSuccess(); onClose() }, 2000)
      } else if (res.status === 401) {
        toast({
          title: 'Session Expired',
          description: 'Your login session expired. Please log in again, then click "I\'ve Paid" once more.',
          variant: 'destructive',
          duration: 10000,
        })
      } else if (res.status === 400 && data.error === 'Already verified') {
        setStatus('success')
        if (pollRef.current) clearInterval(pollRef.current)
        if (elapsedRef.current) clearInterval(elapsedRef.current)
        toast({ title: '✅ Already Verified!', description: `${planName} is already active.`, duration: 6000 })
        setTimeout(() => { onSuccess(); onClose() }, 2000)
      } else {
        toast({
          title: 'Verification Issue',
          description: data.error || 'We could not verify your payment. Please wait 30 seconds and try again.',
          variant: 'destructive',
          duration: 8000,
        })
      }
    } catch (err: any) {
      toast({
        title: 'Network Error',
        description: err.message || 'Network error. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setVerifying(false)
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
            {status === 'success' ? 'Payment Successful!' : 'UPI Payment'}
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

            {imapEnabled === false && (
              <div className="text-[11px] text-blue-700 bg-blue-50 p-2.5 rounded-xl border border-blue-200 text-left">
                💡 Auto-verification is not configured. After paying, click <strong>"I've Paid — Verify Now"</strong> below.
              </div>
            )}

            <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              {imapEnabled === false
                ? 'Click below after paying to verify instantly'
                : 'Auto-verifying... (checks every 5s)'}
            </div>

            <Button
              onClick={handleManualVerify}
              disabled={verifying}
              className={`w-full ${imapEnabled === false ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
              variant={imapEnabled === false ? 'default' : 'outline'}
            >
              {verifying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Verifying payment...
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4 mr-2" />
                  I've Paid — Verify Now
                </>
              )}
            </Button>

            <p className="text-[10px] text-center text-slate-400">
              Time remaining: {formatElapsed(remainingSec)}
            </p>
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
