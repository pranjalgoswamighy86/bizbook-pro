'use client'

import { useState, useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, AlertTriangle, Copy } from 'lucide-react'
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
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  useEffect(() => {
    if (!open || !tenantId) return
    initiate()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [open])

  const initiate = async () => {
    setStatus('initiating'); setLoading(true)
    try {
      const res = await authFetch('/api/upi-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'initiate', tenantId, planHours }) })
      const data = await res.json()
      if (!res.ok) { setStatus('error'); return }
      setCheckout(data); setStatus('waiting'); startPolling(data.queueId)
    } catch { setStatus('error') } finally { setLoading(false) }
  }

  const startPolling = (qid: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await authFetch('/api/upi-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check-status', tenantId, queueId: qid }) })
        const data = await res.json()
        if (data.status === 'SUCCESS') { setStatus('success'); if (pollRef.current) clearInterval(pollRef.current); toast({ title: '✅ Payment Verified!', description: `${planName} activated!`, duration: 6000 }); setTimeout(() => { onSuccess(); onClose() }, 2000) }
        else if (data.status === 'EXPIRED') { setStatus('expired'); if (pollRef.current) clearInterval(pollRef.current) }
      } catch {}
    }, 5000)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { if (pollRef.current) clearInterval(pollRef.current); onClose() } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle className="text-center">{status === 'success' ? 'Payment Successful!' : 'UPI Payment'}</DialogTitle></DialogHeader>
        {(status === 'initiating' || loading) && <div className="flex flex-col items-center gap-3 py-8"><Loader2 className="h-10 w-10 animate-spin text-emerald-600" /><p className="text-sm text-muted-foreground">Generating QR...</p></div>}
        {status === 'waiting' && checkout && (
          <div className="text-center space-y-3">
            <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border"><span className="text-xs text-slate-400 block">Pay Exactly</span><span className="text-2xl font-black text-emerald-600">₹{checkout.finalAmount.toFixed(2)}</span></div>
            <div className="flex justify-center p-3 bg-white border rounded-2xl mx-auto w-fit"><img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(checkout.upiUri)}&bgcolor=ffffff&color=000000&ecc=H`} alt="UPI QR" className="w-44 h-44" /></div>
            <p className="text-xs text-slate-500">Pay to: <strong>{checkout.payeeVPA}</strong></p>
            <Button variant="outline" size="sm" className="w-full" onClick={() => { navigator.clipboard.writeText(checkout.upiUri); toast({ title: 'Copied!' }) }}><Copy className="h-3 w-3 mr-1.5" />Copy UPI Link</Button>
            <div className="text-[11px] font-semibold text-amber-700 bg-amber-50 p-2.5 rounded-xl border border-amber-200 text-left">⚠️ Pay the <strong>exact amount</strong> (₹{checkout.finalAmount.toFixed(2)}) including paise. Rounding off breaks auto-verification.</div>
            <div className="flex items-center justify-center gap-2 text-xs text-slate-400"><Loader2 className="h-3 w-3 animate-spin" />Waiting for payment...</div>
          </div>
        )}
        {status === 'success' && <div className="flex flex-col items-center gap-3 py-6"><CheckCircle2 className="h-16 w-16 text-emerald-600" /><p className="text-lg font-bold text-emerald-700">Activated!</p><p className="text-sm text-muted-foreground">{planName} is now active.</p></div>}
        {status === 'expired' && <div className="flex flex-col items-center gap-3 py-6"><AlertTriangle className="h-12 w-12 text-amber-500" /><Button variant="outline" size="sm" onClick={initiate}>Generate New QR</Button></div>}
        {status === 'error' && <div className="flex flex-col items-center gap-3 py-6"><AlertTriangle className="h-12 w-12 text-red-500" /><Button variant="outline" size="sm" onClick={initiate}>Retry</Button></div>}
        <DialogFooter><Button variant="outline" onClick={() => { if (pollRef.current) clearInterval(pollRef.current); onClose() }}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
