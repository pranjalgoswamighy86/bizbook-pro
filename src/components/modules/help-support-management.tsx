'use client'

/**
 * Help & Support Management Panel (v4.63)
 * Super Admin only — view and respond to AI chat support tickets.
 */

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { authFetch } from '@/lib/auth-fetch'
import { Loader2, RefreshCw, MessageSquare, Check, Clock, AlertCircle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

interface Ticket {
  id: string
  userEmail: string
  tenantName: string
  userQuery: string
  optimizedQuery: string
  aiResponse: string
  category: string
  needsHumanSupport: boolean
  status: string
  adminResponse: string | null
  createdAt: string
}

export function HelpSupportManagement() {
  const { toast } = useToast()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [respondTicket, setRespondTicket] = useState<Ticket | null>(null)
  const [responseText, setResponseText] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await authFetch('/api/help-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list' }),
      })
      const data = await res.json()
      if (res.ok && data.success) setTickets(data.tickets)
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleRespond = async () => {
    if (!respondTicket || !responseText.trim()) return
    try {
      const res = await authFetch('/api/help-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'respond', ticketId: respondTicket.id, adminResponse: responseText.trim() }),
      })
      if (res.ok) {
        toast({ title: 'Response sent', description: 'Ticket resolved.' })
        setRespondTicket(null)
        setResponseText('')
        load()
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    }
  }

  const handleClose = async (id: string) => {
    try {
      await authFetch('/api/help-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close', ticketId: id }),
      })
      toast({ title: 'Ticket closed' })
      load()
    } catch {}
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      OPEN: 'bg-rose-100 text-rose-700',
      AI_RESOLVED: 'bg-emerald-100 text-emerald-700',
      ADMIN_REVIEWING: 'bg-amber-100 text-amber-700',
      RESOLVED: 'bg-slate-100 text-slate-500',
    }
    return colors[status] || 'bg-slate-100 text-slate-600'
  }

  const openTickets = tickets.filter(t => t.status === 'OPEN' || t.status === 'ADMIN_REVIEWING')
  const resolvedTickets = tickets.filter(t => t.status === 'RESOLVED' || t.status === 'AI_RESOLVED')

  return (
    <div className="space-y-4 p-4 sm:p-6 pb-8">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Help &amp; Support Management</h2>
          <p className="text-sm text-slate-500">View and respond to user support queries from AI chat</p>
        </div>
        <Button onClick={load} disabled={loading} variant="outline" size="sm">
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3">
          <div className="text-xs text-rose-700 font-semibold">Open (Needs Human)</div>
          <div className="text-2xl font-bold text-rose-800">{openTickets.filter(t => t.needsHumanSupport).length}</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
          <div className="text-xs text-emerald-700 font-semibold">AI Resolved</div>
          <div className="text-2xl font-bold text-emerald-800">{tickets.filter(t => t.status === 'AI_RESOLVED').length}</div>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
          <div className="text-xs text-slate-700 font-semibold">Total Tickets</div>
          <div className="text-2xl font-bold text-slate-800">{tickets.length}</div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      )}

      {!loading && openTickets.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm text-slate-600">Open Tickets</h3>
          {openTickets.map(t => (
            <div key={t.id} className="bg-white border rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${statusBadge(t.status)}`}>{t.status}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-blue-100 text-blue-700 ml-1">{t.category}</span>
                  {t.needsHumanSupport && <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-rose-100 text-rose-700 ml-1">Needs Human</span>}
                </div>
                <span className="text-[11px] text-slate-400">{new Date(t.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
              </div>
              <div className="space-y-1 text-sm">
                <p><strong>From:</strong> {t.userEmail} ({t.tenantName})</p>
                <p><strong>Query:</strong> {t.userQuery}</p>
                <p className="text-slate-500"><strong>AI Summary:</strong> {t.optimizedQuery}</p>
                <p className="text-emerald-700"><strong>AI Response:</strong> {t.aiResponse}</p>
                {t.adminResponse && <p className="text-blue-700"><strong>Admin Response:</strong> {t.adminResponse}</p>}
              </div>
              <div className="flex gap-2 mt-3">
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => { setRespondTicket(t); setResponseText(t.adminResponse || '') }}>
                  <MessageSquare className="h-3 w-3 mr-1" /> Respond
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleClose(t.id)}>
                  <Check className="h-3 w-3 mr-1" /> Close
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && resolvedTickets.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm text-slate-600">Resolved / AI-Handled</h3>
          {resolvedTickets.slice(0, 10).map(t => (
            <div key={t.id} className="bg-slate-50 border rounded-xl p-3">
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${statusBadge(t.status)}`}>{t.status}</span>
                <span className="text-[11px] text-slate-400">{new Date(t.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</span>
              </div>
              <p className="text-xs"><strong>{t.userEmail}:</strong> {t.optimizedQuery}</p>
              <p className="text-xs text-slate-500 mt-1">AI: {t.aiResponse.slice(0, 100)}{t.aiResponse.length > 100 ? '...' : ''}</p>
            </div>
          ))}
        </div>
      )}

      {!loading && tickets.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 bg-emerald-50 rounded-xl border border-emerald-200">
          <Check className="h-12 w-12 text-emerald-600 mb-2" />
          <p className="text-emerald-800 font-semibold">No support tickets yet</p>
          <p className="text-sm text-emerald-600">When users ask questions in Help &amp; Support, they'll appear here.</p>
        </div>
      )}

      {/* Respond Dialog */}
      <Dialog open={!!respondTicket} onOpenChange={(v) => !v && setRespondTicket(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Respond to Support Ticket</DialogTitle></DialogHeader>
          {respondTicket && (
            <div className="space-y-3">
              <div className="bg-slate-50 p-2 rounded text-xs">
                <p><strong>From:</strong> {respondTicket.userEmail}</p>
                <p><strong>Query:</strong> {respondTicket.userQuery}</p>
                <p className="text-emerald-700 mt-1"><strong>AI said:</strong> {respondTicket.aiResponse}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Your Response</label>
                <Textarea value={responseText} onChange={(e) => setResponseText(e.target.value)} placeholder="Type your response to the user..." rows={4} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRespondTicket(null)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleRespond} disabled={!responseText.trim()}>
              Send &amp; Resolve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
