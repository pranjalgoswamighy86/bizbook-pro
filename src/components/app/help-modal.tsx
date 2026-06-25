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

import { useState, lazy, Suspense } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  HelpCircle, ChevronDown, ChevronRight, Sparkles,
  UserPlus, KeyRound, CreditCard, FileText, ShieldCheck, BookOpen, Lightbulb, MessageCircle, Loader2
} from 'lucide-react'
import { HelpChatTab } from '@/components/app/help-chat'
import { useAppStore } from '@/store/app-store'

// v4.107: Lazy-load HelpSupportManagement for the Manage tab
const HelpSupportManagementInline = lazy(() =>
  import('@/components/modules/help-support-management').then(m => ({ default: m.HelpSupportManagement }))
)

interface HelpModalProps {
  open: boolean
  onClose: () => void
}

interface FAQItem {
  q: string
  a: string
}

const FAQS: FAQItem[] = [
  {
    q: 'How do I register my business?',
    a: 'Go to the login page → click "Register". Enter your business name, address, phone, GST (optional), email, and password. Click "Send OTP" — you will receive a 6-digit OTP via email (Brevo). Enter the OTP to complete registration. You will be logged in automatically.',
  },
  {
    q: 'I am not receiving the OTP email. What should I do?',
    a: 'Check your spam/junk folder first. OTP emails are sent via Brevo email service. If still not received after 2 minutes, click "Resend OTP". If still not received, use the AI Support Chat tab to contact our support team.',
  },
  {
    q: 'How do I reset my password?',
    a: 'On the login page, click "Forgot Password". Enter your registered email → click "Send OTP". You will receive a 6-digit OTP via email. Enter the OTP + your new password → click "Reset Password". You can now login with the new password.',
  },
  {
    q: 'How do I change my password?',
    a: 'Login → Sidebar → Settings → Change Password. Enter your current (old) password + new password. No OTP required. Click "Change Password" to save.',
  },
  {
    q: 'How do I buy a subscription plan?',
    a: 'Sidebar → Subscription → click "Buy" on any plan (50/100/200/500/1000 Hrs). A UPI QR code appears. Pay the EXACT amount shown (including paise, e.g., ₹150.01 not ₹150) via any UPI app (GPay/PhonePe/Paytm).',
  },
  {
    q: 'How is my payment verified?',
    a: 'Three methods (in order of speed): 1) SMS webhook (instant, if configured) — bank SMS alert auto-matches your amount. 2) Email IMAP scraper (2-5 min, if configured) — bank email alert auto-matches. 3) Manual proof — upload screenshot + UTR number, admin reviews and approves within minutes.',
  },
  {
    q: 'I paid but my plan is not activated. What do I do?',
    a: 'After paying, click "Submit Payment Proof" in the UPI modal. Upload a screenshot of your UPI success screen + enter the 12-digit UTR number. Admin will review and approve within minutes. The plan activates automatically once approved.',
  },
  {
    q: 'Why was I logged out automatically?',
    a: 'For security, BizBook Pro auto-logs out after 5 minutes of inactivity (no mouse/keyboard/touch activity). This protects your account if you step away. Just login again to continue. NOTE: If a modal/dialog is open (e.g., payment), the timer is extended.',
  },
  {
    q: 'How do I install BizBook Pro as a desktop app?',
    a: 'On desktop Chrome/Edge: Click the install icon (⊕) in the address bar → "Install". On Firefox: Menu → "Install this site as an app". On iPhone Safari: Share → "Add to Home Screen". The app then opens in its own window without browser chrome.',
  },
  {
    q: 'Can I use BizBook Pro on mobile?',
    a: 'Yes! The app is fully responsive. On mobile, the sidebar becomes a drawer — tap the hamburger menu (top-left) to open it. The "Download Desktop" button is hidden on mobile (it only works on desktop browsers).',
  },
  {
    q: 'How do I add staff/users to my tenant?',
    a: 'Login as MAIN_ADMIN → Settings → Users → "Add User". Enter their name, email, role (DATA_ENTRY/JUNIOR_ADMIN/MAIN_ADMIN). They will receive an email to set their password. Roles control what they can see/edit.',
  },
  {
    q: 'What is the "Smart AI Company Valuation" feature?',
    a: 'Sidebar → Smart AI Company Valuation. Enter your financial data (revenue, profit, assets, liabilities). The AI analyzes it and gives you an estimated business valuation range. Useful for selling/investing/pitching.',
  },
]

const GUIDES = [
  {
    icon: UserPlus,
    title: 'Register your business',
    steps: [
      'Go to login page → click "Register"',
      'Enter business name, address, phone, email, password',
      'Click "Send OTP" — check email for 6-digit code',
      'Enter OTP → click "Verify & Register"',
      'You are now logged in to your new tenant',
    ],
  },
  {
    icon: KeyRound,
    title: 'Forgot password',
    steps: [
      'Login page → click "Forgot Password"',
      'Enter your registered email',
      'Click "Send OTP" — check email for 6-digit code',
      'Enter OTP + new password',
      'Click "Reset Password" → login with new password',
    ],
  },
  {
    icon: CreditCard,
    title: 'Buy a subscription',
    steps: [
      'Sidebar → Subscription',
      'Click "Buy" on your preferred plan (50/100/200/500/1000 Hrs)',
      'UPI QR appears — pay EXACT amount (incl. paise) via UPI app',
      'Click "I\'ve Paid — Check Status" to verify',
      'If not auto-verified, click "Submit Payment Proof"',
      'Upload screenshot + enter UTR → admin reviews → plan activates',
    ],
  },
  {
    icon: FileText,
    title: 'Create your first invoice/sale',
    steps: [
      'Sidebar → Inventory → "Add Item" (add products first)',
      'Sidebar → Sale Register → "New Sale"',
      'Select party (or add new) → select items → set qty',
      'Verify total → click "Save Sale"',
      'Invoice is generated → download/print/email as needed',
    ],
  },
]

export function HelpModal({ open, onClose }: HelpModalProps) {
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(0)
  const [activeTab, setActiveTab] = useState<'faq' | 'guides' | 'chat' | 'management'>('faq')
  const { user, tenant } = useAppStore()
  // v4.107: Super Admin check for Management tab
  const SUPER_ADMIN_EMAILS = ['admin@bizbook.pro', 'pranjalgoswamighy86@gmail.com']
  const isSuperAdmin = user ? SUPER_ADMIN_EMAILS.includes(user.email.toLowerCase()) : false

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
            {FAQS.map((faq, idx) => (
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
            {GUIDES.map((guide, idx) => (
              <div key={idx} className="border rounded-lg p-3 sm:p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                    <guide.icon className="h-4 w-4 text-emerald-600" />
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
            ))}
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
            <HelpChatTab userEmail={user?.email} tenantName={tenant?.name} />
          </div>
        )}

        {activeTab === 'management' && isSuperAdmin && (
          <div className="space-y-3">
            <div className="bg-violet-50 border border-violet-200 rounded-lg p-2 sm:p-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-violet-600 flex-shrink-0" />
              <p className="text-xs text-violet-700">
                Support ticket management — review and respond to user support requests.
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
          <span className="hidden sm:inline">BizBook Pro v4.64 — A Product by Tahigo International</span>
          <span className="sm:hidden text-[11px]">v4.64 — Tahigo International</span>
          <Button variant="outline" size="sm" onClick={onClose} className="min-h-9">Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
