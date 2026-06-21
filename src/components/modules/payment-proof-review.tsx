'use client'

/**
 * Payment Proof Review Panel — v4.47
 * ===================================
 * Super Admin ONLY — review payment proofs submitted by users.
 *
 * Shows pending proofs (status=PROOF_SUBMITTED) with:
 *   - Tenant name/email/phone
 *   - Plan name + amount
 *   - UTR number (user-entered)
 *   - Screenshot thumbnail (click to enlarge)
 *   - Approve / Reject buttons
 *
 * On approve: subscription auto-activates, user's modal auto-detects SUCCESS.
 * On reject: status returns to PENDING, user can re-submit proof.
 */

import { useState, useEffect } from 'react'
import { useAppStore } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/lib/auth-fetch'
import {
  Loader2, CheckCircle2, XCircle, ExternalLink, Clock, Search,
  ImageIcon, ShieldCheck, AlertTriangle, RefreshCw
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog'

interface PendingProof {
  queueId: string
  tenantId: string
  tenantName: string
  tenantEmail: string
  tenantPhone: string
  planName: string
  planHours: number
  finalAmount: number
  utrNumber: string
  screenshotPath: string
  screenshotUrl: string
  submittedAt: string
  queueCreatedAt: string
  reviewNotes: string | null
}

export function PaymentProofReview() {
  const { toast } = useToast()
  const { sessionToken } = useAppStore()
  const [proofs, setProofs] = useState<PendingProof[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null) // queueId being acted on
  const [search, setSearch] = useState('')
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [rejectQueueId, setRejectQueueId] = useState<string | null>(null)
  const [rejectNotes, setRejectNotes] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await authFetch('/api/payment-proof/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list-pending' }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setProofs(data.proofs)
      } else {
        toast({ title: 'Load failed', description: data.error, variant: 'destructive' })
      }
    } catch (err: any) {
      toast({ title: 'Network error', description: err.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // Auto-refresh every 30 seconds
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [])

  const handleApprove = async (queueId: string) => {
    setActionLoading(queueId)
    try {
      const res = await authFetch('/api/payment-proof/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          queueId,
          reviewNotes: 'Approved via Super Admin panel',
        }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        toast({
          title: '✅ Approved',
          description: data.message,
          duration: 6000,
        })
        // Remove from list
        setProofs(proofs.filter(p => p.queueId !== queueId))
      } else {
        toast({ title: 'Approval failed', description: data.error, variant: 'destructive' })
      }
    } catch (err: any) {
      toast({ title: 'Network error', description: err.message, variant: 'destructive' })
    } finally {
      setActionLoading(null)
    }
  }

  const handleRejectSubmit = async () => {
    if (!rejectQueueId) return
    if (!rejectNotes.trim()) {
      toast({ title: 'Reason required', description: 'Please provide a reason for rejection.', variant: 'destructive' })
      return
    }
    setActionLoading(rejectQueueId)
    try {
      const res = await authFetch('/api/payment-proof/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reject',
          queueId: rejectQueueId,
          reviewNotes: rejectNotes.trim(),
        }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        toast({ title: 'Proof Rejected', description: data.message, duration: 6000 })
        setProofs(proofs.filter(p => p.queueId !== rejectQueueId))
        setRejectQueueId(null)
        setRejectNotes('')
      } else {
        toast({ title: 'Reject failed', description: data.error, variant: 'destructive' })
      }
    } catch (err: any) {
      toast({ title: 'Network error', description: err.message, variant: 'destructive' })
    } finally {
      setActionLoading(null)
    }
  }

  const filtered = proofs.filter(p =>
    !search ||
    p.tenantName.toLowerCase().includes(search.toLowerCase()) ||
    p.tenantEmail.toLowerCase().includes(search.toLowerCase()) ||
    p.utrNumber.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-4 p-4 sm:p-6 pb-8">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Payment Proof Review</h2>
          <p className="text-sm text-slate-500">
            Review payment proofs submitted by tenants (UTR + screenshot)
          </p>
        </div>
        <Button onClick={load} disabled={loading} variant="outline" size="sm">
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <div className="text-xs text-amber-700 font-semibold">Pending Review</div>
          <div className="text-2xl font-bold text-amber-800">{proofs.length}</div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
          <div className="text-xs text-blue-700 font-semibold">Auto-refresh</div>
          <div className="text-sm font-bold text-blue-800">Every 30s</div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search by tenant name, email, or UTR..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Loading */}
      {loading && proofs.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          <span className="ml-2 text-slate-500">Loading pending proofs...</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && proofs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 bg-emerald-50 rounded-xl border border-emerald-200">
          <CheckCircle2 className="h-12 w-12 text-emerald-600 mb-2" />
          <p className="text-emerald-800 font-semibold">All caught up!</p>
          <p className="text-sm text-emerald-600">No pending payment proofs to review.</p>
        </div>
      )}

      {/* Proof cards */}
      <div className="space-y-3">
        {filtered.map((proof) => (
          <div key={proof.queueId} className="bg-white border rounded-xl p-4 shadow-sm">
            <div className="grid md:grid-cols-3 gap-4">
              {/* Screenshot */}
              <div className="md:col-span-1">
                <div className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1">
                  <ImageIcon className="h-3.5 w-3.5" />
                  Payment Screenshot
                </div>
                <button
                  onClick={() => setPreviewImage(proof.screenshotUrl)}
                  className="block w-full aspect-square bg-slate-100 rounded-lg border border-slate-200 overflow-hidden hover:opacity-90 transition-opacity"
                >
                  <img
                    src={proof.screenshotUrl}
                    alt="Payment screenshot"
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      // If image fails to load, show a placeholder
                      (e.target as HTMLImageElement).style.display = 'none'
                      const parent = (e.target as HTMLImageElement).parentElement
                      if (parent) {
                        parent.innerHTML = '<div class="flex items-center justify-center h-full text-slate-400 text-xs"><ImageIcon class="h-8 w-8" /></div>'
                      }
                    }}
                  />
                </button>
                <a
                  href={proof.screenshotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center text-xs text-emerald-600 hover:underline mt-1"
                >
                  <ExternalLink className="h-3 w-3 inline mr-1" />
                  Open full size
                </a>
              </div>

              {/* Details */}
              <div className="md:col-span-2 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs font-semibold text-slate-500">Tenant</div>
                    <div className="font-semibold text-slate-800">{proof.tenantName}</div>
                    <div className="text-xs text-slate-500">{proof.tenantEmail}</div>
                    <div className="text-xs text-slate-500">{proof.tenantPhone}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-500">Plan</div>
                    <div className="font-semibold text-emerald-700">{proof.planName}</div>
                    <div className="text-xs text-slate-500">₹{proof.finalAmount.toFixed(2)}</div>
                    <div className="text-xs text-slate-500">{proof.planHours} hours</div>
                  </div>
                </div>

                <div className="border-t pt-3 space-y-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-500">UTR Number</div>
                    <div className="font-mono font-bold text-slate-800 text-base bg-slate-50 px-2 py-1 rounded border">
                      {proof.utrNumber}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="font-semibold text-slate-500">Submitted:</span>{' '}
                      <span className="text-slate-700">
                        {new Date(proof.submittedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-slate-500">Queue created:</span>{' '}
                      <span className="text-slate-700">
                        {new Date(proof.queueCreatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Admin verification tips */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 text-[11px] text-blue-800">
                  <p className="font-semibold mb-1">Verification steps:</p>
                  <ol className="list-decimal list-inside space-y-0.5">
                    <li>Open your bank's net banking / UPI app</li>
                    <li>Search transactions for UTR: <strong>{proof.utrNumber}</strong></li>
                    <li>Confirm amount = ₹{proof.finalAmount.toFixed(2)}</li>
                    <li>Confirm recipient = your VPA</li>
                    <li>If all match → click Approve below</li>
                  </ol>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => handleApprove(proof.queueId)}
                    disabled={actionLoading === proof.queueId}
                    className="bg-emerald-600 hover:bg-emerald-700 flex-1"
                  >
                    {actionLoading === proof.queueId ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                    )}
                    Approve &amp; Activate
                  </Button>
                  <Button
                    onClick={() => { setRejectQueueId(proof.queueId); setRejectNotes('') }}
                    disabled={actionLoading === proof.queueId}
                    variant="outline"
                    className="border-red-200 text-red-700 hover:bg-red-50"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Reject
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Image preview modal */}
      <Dialog open={!!previewImage} onOpenChange={(v) => !v && setPreviewImage(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Payment Screenshot</DialogTitle>
          </DialogHeader>
          {previewImage && (
            <img src={previewImage} alt="Payment screenshot" className="w-full h-auto" />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewImage(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectQueueId} onOpenChange={(v) => !v && setRejectQueueId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Payment Proof</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                The user will be able to submit a new proof after rejection.
                Please provide a clear reason so they know what to fix.
              </p>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Reason for rejection <span className="text-red-500">*</span>
              </label>
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                placeholder="e.g., UTR not found in bank statement, screenshot unclear, amount mismatch..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-500"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectQueueId(null)}>Cancel</Button>
            <Button
              onClick={handleRejectSubmit}
              disabled={actionLoading === rejectQueueId || !rejectNotes.trim()}
              className="bg-red-600 hover:bg-red-700"
            >
              {actionLoading === rejectQueueId ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4 mr-2" />
              )}
              Reject Proof
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
