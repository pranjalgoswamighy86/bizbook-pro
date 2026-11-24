'use client'

/**
 * Help Modal — v4.52 (Mobile-compatible)
 * =======================================
 * v4.52 FIX: Screen not compatible on mobile devices
 *   - Tabs: scrollable horizontally on mobile (overflow-x-auto)
 *   - Tab labels: short on mobile, full on desktop (responsive)
 *   - Dialog: full-width on mobile, max-w-2xl on desktop
 *   - Padding: p-3 on mobile, p-6 on desktop
 *   - Font sizes: smaller on mobile
 *   - Safe area: respects iPhone notch (env(safe-area-inset-*))
 *   - Contact cards: 1 column on mobile, 2 on desktop
 *   - Guide cards: stack vertically on mobile
 *   - Touch-friendly: larger tap targets (min-h-11 = 44px)
 *
 * Mounted in:
 *   - Sidebar (Help menu item)
 *   - Login page (floating Help button)
 *   - Add Company page (floating Help button)
 */

import { useState, useEffect, lazy, Suspense } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  HelpCircle, ChevronDown, ChevronRight, Sparkles,
  UserPlus, KeyRound, CreditCard, FileText, ShieldCheck, BookOpen, Lightbulb, MessageCircle, Loader2
} from 'lucide-react'
import { HelpChatTab } from '@/components/app/help-chat'
import { useAppStore } from '@/store/app-store'
import { HELP_FAQS, HELP_GUIDES } from '@/lib/help-knowledge'
import { APP_VERSION } from '@/lib/version'
import { authFetch } from '@/lib/auth-fetch'

// v4.107: Lazy-load HelpSupportManagement for the Manage tab
const HelpSupportManagementInline = lazy(() =>
  import('@/components/modules/help-support-management').then(m => ({ default: m.HelpSupportManagement }))
)

interface HelpModalProps {
  open: boolean
  onClose: () => void
  /** v6.17: Optional initial tab. Used by F1 / "AI Support Chat" menu action
   *  to jump straight to the AI chat tab. Defaults to 'faq'. */
  initialTab?: 'faq' | 'guides' | 'chat' | 'management'
}

const GUIDE_ICONS: Record<string, typeof UserPlus> = {
  'user-plus': UserPlus,
  key: KeyRound,
  'credit-card': CreditCard,
  'file-text': FileText,
  lightbulb: Lightbulb,
  shield: ShieldCheck,
}

export function HelpModal({ open, onClose, initialTab = 'faq' }: HelpModalProps) {
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(0)
  const [activeTab, setActiveTab] = useState<'faq' | 'guides' | 'chat' | 'management'>(initialTab)
  const { user, tenant } = useAppStore()
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)

  // Ask the server whether this signed-in account is authorised for support management.
  // Do not maintain a separate client-side email allowlist.
  useEffect(() => {
    if (!open || !user?.id) {
      setIsSuperAdmin(false)
      return
    }
    let active = true
    authFetch('/api/help-tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'access' }),
    })
      .then(async response => {
        if (!response.ok) return false
        const data = await response.json()
        return data.allowed === true
      })
      .then(allowed => { if (active) setIsSuperAdmin(allowed) })
      .catch(() => { if (active) setIsSuperAdmin(false) })
    return () => { active = false }
  }, [open, user?.id])

  // v6.17: When the modal opens, sync the active tab to `initialTab`.
  // This lets F1 / menu action re-open the modal on the Chat tab even if
  // the user previously switched to FAQ or Guides.
  useEffect(() => {
    if (open) {
      setActiveTab(initialTab)
    }
  }, [open, initialTab])

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="
          // v4.52: Mobile-first responsive sizing
          w-[calc(100vw-1rem)]
          max-w-[calc(100vw-1rem)]
          sm:max-w-2xl
          max-h-[90vh]
          sm:max-h-[85vh]
          overflow-y-auto
          p-3 sm:p-6
          // iPhone safe area support
          [padding-top:max(0.75rem,env(safe-area-inset-top))]
          [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]
        "
      >
        <DialogHeader className="space-y-2">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <HelpCircle className="h-5 w-5 text-emerald-600 flex-shrink-0" />
            <span>Help &amp; Support</span>
          </DialogTitle>
        </DialogHeader>

        {/* Tabs — scrollable horizontally on mobile */}
        <div className="
          flex gap-1.5 sm:gap-2 border-b pb-2 mb-3 sm:mb-4
          overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none]
          [&::-webkit-scrollbar]:hidden
          -mx-1 px-1
        ">
          <Button
            variant={activeTab === 'faq' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('faq')}
            className={`
              flex-shrink-0 min-h-11 px-3 sm:px-4
              ${activeTab === 'faq' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
            `}
          >
            <HelpCircle className="h-4 w-4 sm:mr-1.5 flex-shrink-0" />
            <span className="text-xs sm:text-sm">FAQ</span>
          </Button>
          <Button
            variant={activeTab === 'guides' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('guides')}
            className={`
              flex-shrink-0 min-h-11 px-3 sm:px-4
              ${activeTab === 'guides' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
            `}
          >
            <BookOpen className="h-4 w-4 sm:mr-1.5 flex-shrink-0" />
            <span className="text-xs sm:text-sm">
              <span className="sm:hidden">Guides</span>
              <span className="hidden sm:inline">Step-by-Step Guides</span>
            </span>
          </Button>
          <Button
            variant={activeTab === 'chat' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('chat')}
            className={`
              flex-shrink-0 min-h-11 px-3 sm:px-4
              ${activeTab === 'chat' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
            `}
          >
            <MessageCircle className="h-4 w-4 sm:mr-1.5 flex-shrink-0" />
            <span className="text-xs sm:text-sm">
              <span className="sm:hidden">Chat</span>
              <span className="hidden sm:inline">AI Support Chat</span>
            </span>
          </Button>
          {isSuperAdmin && (
            <Button
              variant={activeTab === 'management' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('management')}
              className={`
                flex-shrink-0 min-h-11 px-3 sm:px-4
                ${activeTab === 'management' ? 'bg-violet-600 hover:bg-violet-700' : ''}
              `}
            >
              <ShieldCheck className="h-4 w-4 sm:mr-1.5 flex-shrink-0" />
              <span className="text-xs sm:text-sm">Manage</span>
            </Button>
          )}
        </div>

        {/* FAQ Tab */}
        {activeTab === 'faq' && (
          <div className="space-y-2">
            {HELP_FAQS.map((faq, idx) => (
              <div key={idx} className="border rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedFAQ(expandedFAQ === idx ? null : idx)}
                  className="
                    w-full px-3 sm:px-4 py-3 text-left flex items-start gap-2
                    hover:bg-slate-50 active:bg-slate-100 transition-colors
                    min-h-11
                  "
                >
                  {expandedFAQ === idx ? (
                    <ChevronDown className="h-4 w-4 mt-0.5 text-slate-400 flex-shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 mt-0.5 text-slate-400 flex-shrink-0" />
                  )}
                  <span className="font-medium text-xs sm:text-sm text-slate-800 leading-snug">{faq.q}</span>
                </button>
                {expandedFAQ === idx && (
                  <div className="px-3 sm:px-4 pb-3 pl-9 sm:pl-10 text-xs sm:text-sm text-slate-600 leading-relaxed">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Guides Tab */}
        {activeTab === 'guides' && (
          <div className="space-y-3 sm:space-y-4">
            {HELP_GUIDES.map((guide, idx) => {
              const GuideIcon = GUIDE_ICONS[guide.icon] || BookOpen
              return (
              <div key={idx} className="border rounded-lg p-3 sm:p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                    <GuideIcon className="h-4 w-4 text-emerald-600" />
                  </div>
                  <h3 className="font-semibold text-sm sm:text-base text-slate-800">{guide.title}</h3>
                </div>
                <ol className="space-y-1.5 text-xs sm:text-sm text-slate-600">
                  {guide.steps.map((step, stepIdx) => (
                    <li key={stepIdx} className="flex gap-2">
                      <span className="flex-shrink-0 h-5 w-5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold flex items-center justify-center">
                        {stepIdx + 1}
                      </span>
                      <span className="pt-0.5 leading-snug">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
              )
            })}
          </div>
        )}

        {/* AI Chat Tab (v4.63 — replaces Contact Support) */}
        {activeTab === 'chat' && (
          <div className="space-y-3">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 sm:p-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-600 flex-shrink-0" />
              <p className="text-xs text-emerald-700">
                Chat with our AI assistant — get instant answers. Complex queries are forwarded to admin.
              </p>
            </div>
            <HelpChatTab tenantId={tenant?.id} />
          </div>
        )}

        {activeTab === 'management' && isSuperAdmin && (
          <div className="space-y-3">
            <div className="bg-violet-50 border border-violet-200 rounded-lg p-2 sm:p-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-violet-600 flex-shrink-0" />
              <p className="text-xs text-violet-700">
                Support ticket management — review and respond to user support requests. This tab is only visible to Super Admins.
              </p>
            </div>
            <div className="max-h-[50vh] overflow-y-auto">
              <Suspense fallback={<div className="flex justify-center py-8 text-sm text-muted-foreground">Loading management panel...</div>}>
                <HelpSupportManagementInline />
              </Suspense>
            </div>
          </div>
        )}

        <div className="border-t pt-3 mt-3 sm:mt-4 flex items-center justify-between text-xs text-slate-500 gap-2">
          <span className="hidden sm:inline">BizBook Pro {APP_VERSION} — A Product by Tahigo International</span>
          <span className="sm:hidden text-[11px]">{APP_VERSION} — Tahigo International</span>
          <Button variant="outline" size="sm" onClick={onClose} className="min-h-9">Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
