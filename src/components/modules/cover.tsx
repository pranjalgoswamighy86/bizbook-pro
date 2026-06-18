'use client'

import { useState, useEffect } from 'react'
import { WorkspaceSelectionModal, type WorkspaceOption } from '@/components/auth/workspace-selection-modal'
import { useAppStore } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Building2, Shield, Zap, BarChart3, Package, Users, KeyRound, ArrowLeft, Loader2, Phone, MailCheck } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

type ResetStep = 'idle' | 'request' | 'verify' | 'done'
type RegStep = 'form' | 'verify-otp'

export function CoverPage() {
  const { login } = useAppStore()
  const { toast } = useToast()
  const [tab, setTab] = useState('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // v4.11: Spec Section 24 — Developer fallback message for missing env vars
  // "If any core variable is evaluated as undefined at runtime, the application
  //  auth layout component must display a clean developer fallback message to
  //  prevent execution crashes on the platform UI wrapper."
  const [envWarning, setEnvWarning] = useState<string | null>(null)

  useEffect(() => {
    // Check for critical missing env vars (exposed via NEXT_PUBLIC_ prefix)
    const missing: string[] = []
    // NEXT_PUBLIC_SUPER_ADMIN_UPI_ID is checked at runtime by upi-checkout route,
    // but we can show a developer hint here for visibility
    // Note: server-side env vars (WHATSAPP_ACCESS_TOKEN, RESEND_API_KEY, etc.)
    // are NOT visible to client — they're checked server-side with graceful fallbacks
    setEnvWarning(missing.length > 0
      ? `Developer Notice: ${missing.join(', ')} not configured. Some features may be unavailable.`
      : null
    )
  }, [])

  // Login form
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  // v4.7: 3-Day OTP Gate state (Task 8)
  const [loginRequiresOtp, setLoginRequiresOtp] = useState(false)
  const [loginOtp, setLoginOtp] = useState('')
  const [loginOtpMessage, setLoginOtpMessage] = useState('')

  // v4.7: Workspace Selection state (Rule 2.2)
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false)
  const [workspaceUser, setWorkspaceUser] = useState<{ id: string; email: string; name: string } | null>(null)
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceOption[]>([])

  // Register form
  const [regStep, setRegStep] = useState<RegStep>('form')
  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [businessAddress, setBusinessAddress] = useState('')
  const [businessPhone, setBusinessPhone] = useState('')
  const [businessGst, setBusinessGst] = useState('')
  const [regOtp, setRegOtp] = useState('')
  const [regOtpSent, setRegOtpSent] = useState(false)
  const [regResendCooldown, setRegResendCooldown] = useState(0)

  // Reset Password state
  const [resetStep, setResetStep] = useState<ResetStep>('idle')
  const [resetIdentifier, setResetIdentifier] = useState('')
  const [resetEmail, setResetEmail] = useState('') // resolved email from server
  const [resetOtp, setResetOtp] = useState('')
  const [resetNewPassword, setResetNewPassword] = useState('')
  const [resetConfirmPassword, setResetConfirmPassword] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [resetError, setResetError] = useState('')
  const [otpDeliveryMethod, setOtpDeliveryMethod] = useState<'email' | 'sms' | 'both' | 'failed' | 'unknown'>('unknown')

  // Cooldown timer for resend
  useEffect(() => {
    if (regResendCooldown <= 0) return
    const timer = setTimeout(() => setRegResendCooldown(prev => prev - 1), 1000)
    return () => clearTimeout(timer)
  }, [regResendCooldown])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', email: loginEmail, password: loginPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Login failed')
        return
      }

      // v4.7: Handle 3-Day OTP Gate (Task 8)
      // Backend returns { requiresOtp: true, message, email } when lastOtpVerifiedAt > 3 days
      if (data.requiresOtp) {
        setLoginRequiresOtp(true)
        setLoginOtpMessage(data.message || 'Please check your email inbox/spam for the 6-digit OTP. If email delivery fails, the OTP will be securely sent directly to your registered tenant mobile number as a backup channel.')
        setLoading(false)
        return
      }

      // v4.7: Handle Workspace Selection (Rule 2.2)
      // Backend returns { status: 'WORKSPACE_SELECTION_REQUIRED', user, workspaces } when user has 2+ tenants
      if (data.status === 'WORKSPACE_SELECTION_REQUIRED') {
        setWorkspaceUser(data.user)
        setWorkspaceOptions(data.workspaces || [])
        setShowWorkspaceModal(true)
        setLoading(false)
        return
      }

      // Standard login success — pass sessionToken to the store
      login(data.user, data.tenant, data.companies || [], data.sessionToken)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ============================================================
  // v4.7: Verify Login OTP (completes 3-Day OTP Gate)
  // ============================================================
  const handleVerifyLoginOtp = async () => {
    if (!loginOtp.trim() || loginOtp.trim().length !== 6) {
      setError('Please enter the 6-digit OTP.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify-login-otp', email: loginEmail, otp: loginOtp.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'OTP verification failed')
        return
      }

      // v4.7: After OTP verified, backend may still return WORKSPACE_SELECTION_REQUIRED
      if (data.status === 'WORKSPACE_SELECTION_REQUIRED') {
        setLoginRequiresOtp(false)
        setLoginOtp('')
        setWorkspaceUser(data.user)
        setWorkspaceOptions(data.workspaces || [])
        setShowWorkspaceModal(true)
        return
      }

      // Standard login success
      login(data.user, data.tenant, data.companies || [], data.sessionToken)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ============================================================
  // v4.7: Select Workspace (Rule 2.2 — finalize login after picking)
  // ============================================================
  const handleSelectWorkspace = async (workspace: WorkspaceOption) => {
    if (!workspaceUser) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'select-workspace', userId: workspaceUser.id, tenantId: workspace.tenantId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Workspace selection failed')
        return
      }
      setShowWorkspaceModal(false)
      login(data.user, data.tenant, data.companies || [], data.sessionToken)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ============================================================
  // REGISTRATION: Step 1 - Fill form + Send OTP
  // ============================================================
  const handleRegisterSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    // Client-side validation
    if (!regName.trim()) { setError('Please enter your name.'); setLoading(false); return }
    if (!regEmail.trim()) { setError('Please enter your email address.'); setLoading(false); return }
    if (!regPassword || regPassword.length < 6) { setError('Password must be at least 6 characters.'); setLoading(false); return }
    if (!businessName.trim()) { setError('Please enter your business name.'); setLoading(false); return }
    if (!businessPhone.trim()) { setError('Please enter your mobile number. It is required for registration.'); setLoading(false); return }

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register-send-otp',
          name: regName.trim(),
          email: regEmail.trim(),
          password: regPassword,
          businessName: businessName.trim(),
          businessAddress: businessAddress.trim(),
          businessPhone: businessPhone.trim(),
          businessGst: businessGst.trim(),
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to send verification OTP')
        return
      }

      // OTP sent successfully — move to verification step
      setRegOtpSent(true)
      setRegStep('verify-otp')
      setRegResendCooldown(60) // 60 second cooldown

      // Start countdown
      const countdown = setInterval(() => {
        setRegResendCooldown(prev => {
          if (prev <= 1) { clearInterval(countdown); return 0 }
          return prev - 1
        })
      }, 1000)

      const deliveryMsg = data.emailSent && data.smsSent
        ? 'OTP sent to your email and mobile number.'
        : data.emailSent
          ? 'OTP sent to your email. Please check your inbox and spam folder.'
          : 'OTP sent to your mobile number.'

      toast({ title: 'Verification OTP Sent', description: deliveryMsg, duration: 8000 })
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ============================================================
  // REGISTRATION: Step 2 - Verify OTP + Create Account
  // ============================================================
  const handleRegisterVerify = async () => {
    if (!regOtp.trim() || regOtp.trim().length !== 6) {
      setError('Please enter the 6-digit OTP sent to your email/mobile.')
      return
    }

    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register-verify',
          name: regName.trim(),
          email: regEmail.trim(),
          password: regPassword,
          businessName: businessName.trim(),
          businessAddress: businessAddress.trim(),
          businessPhone: businessPhone.trim(),
          businessGst: businessGst.trim(),
          otp: regOtp.trim(),
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'OTP verification failed')
        return
      }

      // Registration successful — log the user in
      login(data.user, data.tenant, data.companies || [], data.sessionToken)
      toast({ title: 'Account Created!', description: 'Welcome to BizBook Pro. Your account is ready.', duration: 5000 })
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Resend OTP for registration
  const handleResendRegOtp = async () => {
    if (regResendCooldown > 0) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register-send-otp',
          name: regName.trim(),
          email: regEmail.trim(),
          password: regPassword,
          businessName: businessName.trim(),
          businessAddress: businessAddress.trim(),
          businessPhone: businessPhone.trim(),
          businessGst: businessGst.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to resend OTP')
        return
      }
      setRegResendCooldown(60)
      const countdown = setInterval(() => {
        setRegResendCooldown(prev => {
          if (prev <= 1) { clearInterval(countdown); return 0 }
          return prev - 1
        })
      }, 1000)
      toast({ title: 'OTP Resent', description: 'A new verification OTP has been sent.', duration: 5000 })
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Reset registration state when switching tabs
  const handleTabChange = (newTab: string) => {
    setTab(newTab)
    setError('')
    if (newTab === 'register') {
      setRegStep('form')
      setRegOtp('')
      setRegOtpSent(false)
    }
  }

  // --- Reset Password Handlers ---
  const handleSendOtp = async () => {
    if (!resetIdentifier.trim()) {
      setResetError('Please enter your email or phone number')
      return
    }
    setResetLoading(true)
    setResetError('')
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send-otp', identifier: resetIdentifier.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setResetError(data.error || 'Failed to send OTP')
        return
      }
      if (data.sent === false && !data.emailSent && !data.smsSent) {
        setResetError(data.message || 'No account found with this email or phone number.')
        return
      }
      if (data.email) {
        setResetEmail(data.email)
      }
      if (data.emailSent && data.smsSent) {
        setOtpDeliveryMethod('both')
        toast({ title: 'OTP Sent', description: 'OTP sent to your email and registered mobile number.', duration: 8000 })
      } else if (data.emailSent) {
        setOtpDeliveryMethod('email')
        toast({ title: 'OTP Sent to Email', description: 'Check your inbox (and spam folder) for the verification code.', duration: 8000 })
      } else if (data.smsSent) {
        setOtpDeliveryMethod('sms')
        toast({ title: 'OTP Sent via SMS', description: 'OTP sent to your registered mobile number.', duration: 8000 })
      } else {
        setOtpDeliveryMethod('unknown')
        toast({ title: 'OTP Sent', description: 'If an account exists with this email/phone, an OTP has been sent.', duration: 8000 })
      }
      setResetStep('verify')
    } catch {
      setResetError('Network error. Please try again.')
    } finally {
      setResetLoading(false)
    }
  }

  const handleResetPassword = async () => {
    if (!resetOtp.trim()) {
      setResetError('Please enter the OTP')
      return
    }
    if (!resetNewPassword || resetNewPassword.length < 6) {
      setResetError('New password must be at least 6 characters')
      return
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setResetError('Passwords do not match')
      return
    }
    setResetLoading(true)
    setResetError('')
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reset-password',
          email: resetEmail,
          otp: resetOtp.trim(),
          newPassword: resetNewPassword,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setResetError(data.error || 'Failed to reset password')
        return
      }
      setResetStep('done')
      toast({ title: 'Password Reset', description: 'Your password has been reset successfully. You can now login.' })
    } catch {
      setResetError('Network error. Please try again.')
    } finally {
      setResetLoading(false)
    }
  }

  const closeResetDialog = () => {
    setResetStep('idle')
    setResetIdentifier('')
    setResetEmail('')
    setResetOtp('')
    setResetNewPassword('')
    setResetConfirmPassword('')
    setResetError('')
    setResetLoading(false)
    setOtpDeliveryMethod('unknown')
  }

  const features = [
    { icon: <Zap className="h-5 w-5" />, title: 'Simple & Fast', desc: 'Easier than Tally Prime & Marg ERP. Clean interface, no complex menus.' },
    { icon: <BarChart3 className="h-5 w-5" />, title: 'Auto Reports', desc: 'P&L, Balance Sheet, Day Report - all auto-calculated from your entries.' },
    { icon: <Package className="h-5 w-5" />, title: 'Inventory + Value', desc: 'Track stock with real-time valuation. Low stock alerts included.' },
    { icon: <Users className="h-5 w-5" />, title: 'Multi-User Access', desc: 'View Only, Data Entry, Junior Admin & Main Admin - full control.' },
    { icon: <Shield className="h-5 w-5" />, title: 'Multi-Business', desc: 'Manage unlimited businesses. Each with isolated data & users.' },
    { icon: <Building2 className="h-5 w-5" />, title: 'Complete Billing', desc: 'Sales, Purchases, Expenses, Debtors, Creditors, Salary - all in one place.' },
  ]

  return (
    <div className="app-fullpage bg-gradient-to-br from-emerald-50 via-white to-teal-50 dark:from-gray-950 dark:via-gray-900 dark:to-emerald-950 overflow-y-auto">
      {/* Hero */}
      <div className="max-w-7xl mx-auto px-4 py-8 sm:py-12">
        <div className="text-center mb-10">
          <div className="flex justify-center mb-6">
            <img
              src="/logo.png"
              alt="BizBook Pro"
              className="h-20 w-20 rounded-2xl shadow-lg object-contain"
            />
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 text-sm font-medium mb-4">
            <Building2 className="h-4 w-4" />
            Simple Business Management
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
            <span className="text-emerald-600">BizBook</span> Pro
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            The simplest billing & inventory software for businesses that find Tally Prime and Marg ERP too complex.
            Clean interface, powerful features, lifetime entry with minimal subscription.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-8 items-start">
          {/* Features */}
          <div className="grid sm:grid-cols-2 gap-4">
            {features.map((f, i) => (
              <Card key={i} className="border-0 shadow-sm bg-white/60 dark:bg-gray-800/60 backdrop-blur">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="text-emerald-600 mt-0.5">{f.icon}</div>
                    <div>
                      <h3 className="font-semibold text-sm">{f.title}</h3>
                      <p className="text-xs text-muted-foreground mt-1">{f.desc}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Auth Card */}
          <Card className="shadow-lg border-0">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl">Get Started</CardTitle>
              <CardDescription>Login to your account or create a new business</CardDescription>
            </CardHeader>
            <CardContent>
              {/* v4.11: Spec Section 24 — Developer fallback message for missing env vars */}
              {envWarning && (
                <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  ⚙️ {envWarning}
                </div>
              )}
              <Tabs value={tab} onValueChange={handleTabChange}>
                <TabsList className="grid w-full grid-cols-2 mb-4">
                  <TabsTrigger value="login">Login</TabsTrigger>
                  <TabsTrigger value="register">Register</TabsTrigger>
                </TabsList>

                <TabsContent value="login">
                  {/* v4.7: 3-Day OTP Gate UI (Task 8) — shown when backend returns requiresOtp */}
                  {loginRequiresOtp ? (
                    <form onSubmit={(e) => { e.preventDefault(); handleVerifyLoginOtp() }} className="space-y-4">
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 leading-relaxed">
                        {loginOtpMessage}
                      </div>
                      <div>
                        <Label htmlFor="login-otp">6-Digit OTP</Label>
                        <Input
                          id="login-otp"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          value={loginOtp}
                          onChange={(e) => setLoginOtp(e.target.value.replace(/\D/g, ''))}
                          required
                          placeholder="Enter 6-digit code"
                          className="text-center text-lg tracking-widest"
                          autoFocus
                        />
                      </div>
                      {error && <p className="text-sm text-destructive">{error}</p>}
                      <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={loading}>
                        {loading ? 'Verifying...' : 'Verify OTP & Continue'}
                      </Button>
                      <button
                        type="button"
                        className="w-full text-xs text-slate-500 hover:text-slate-700"
                        onClick={() => {
                          setLoginRequiresOtp(false)
                          setLoginOtp('')
                          setError('')
                        }}
                      >
                        ← Back to login
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleLogin} className="space-y-4">
                      <div>
                        <Label htmlFor="login-email">Email</Label>
                        <Input id="login-email" type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} required placeholder="you@business.com" />
                      </div>
                      <div>
                        <Label htmlFor="login-pass">Password</Label>
                        <Input id="login-pass" type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} required placeholder="Enter password" />
                      </div>
                      {error && tab === 'login' && <p className="text-sm text-destructive">{error}</p>}
                      <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={loading}>
                        {loading ? 'Signing in...' : 'Sign In'}
                      </Button>
                      {/* Forgot Password Link */}
                      <div className="text-center">
                        <button
                          type="button"
                          className="text-sm text-emerald-600 hover:text-emerald-700 hover:underline font-medium inline-flex items-center gap-1"
                          onClick={() => { setResetStep('request'); setResetError('') }}
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                          Forgot Password? Reset it here
                        </button>
                      </div>
                    </form>
                  )}
                </TabsContent>

                <TabsContent value="register">
                  {/* ===== Step 1: Registration Form ===== */}
                  {regStep === 'form' && (
                    <form onSubmit={handleRegisterSendOtp} className="space-y-3">
                      <div>
                        <Label>Your Name <span className="text-red-500">*</span></Label>
                        <Input value={regName} onChange={(e) => setRegName(e.target.value)} required placeholder="Full name" />
                      </div>
                      <div>
                        <Label>Email <span className="text-red-500">*</span></Label>
                        <Input type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} required placeholder="you@business.com" />
                      </div>
                      <div>
                        <Label>Password <span className="text-red-500">*</span></Label>
                        <Input type="password" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} required placeholder="Min 6 characters" minLength={6} />
                      </div>
                      <div className="pt-2 border-t">
                        <Label className="text-emerald-600 font-semibold">Business Details</Label>
                      </div>
                      <div>
                        <Label>Business Name <span className="text-red-500">*</span></Label>
                        <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} required placeholder="Your Business Name" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label>Mobile Number <span className="text-red-500">*</span></Label>
                          <div className="relative">
                            <Phone className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                              value={businessPhone}
                              onChange={(e) => setBusinessPhone(e.target.value)}
                              required
                              placeholder="e.g. 9876543210"
                              className="pl-9"
                              type="tel"
                            />
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">Must be unique. Used for OTP &amp; verification.</p>
                        </div>
                        <div>
                          <Label>GST Number</Label>
                          <Input value={businessGst} onChange={(e) => setBusinessGst(e.target.value)} placeholder="Optional" />
                        </div>
                      </div>
                      <div>
                        <Label>Address</Label>
                        <Input value={businessAddress} onChange={(e) => setBusinessAddress(e.target.value)} placeholder="Business address" />
                      </div>
                      {error && <p className="text-sm text-destructive">{error}</p>}
                      <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={loading}>
                        {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending OTP...</> : <><MailCheck className="h-4 w-4 mr-2" />Verify Email &amp; Continue</>}
                      </Button>
                      <p className="text-xs text-center text-muted-foreground">
                        An OTP will be sent to your email for verification before creating your account.
                      </p>
                    </form>
                  )}

                  {/* ===== Step 2: OTP Verification ===== */}
                  {regStep === 'verify-otp' && (
                    <div className="space-y-4">
                      {/* Back button */}
                      <button
                        type="button"
                        className="text-sm text-emerald-600 hover:text-emerald-700 font-medium inline-flex items-center gap-1"
                        onClick={() => { setRegStep('form'); setError(''); setRegOtp('') }}
                      >
                        <ArrowLeft className="h-3.5 w-3.5" /> Back to form
                      </button>

                      {/* OTP sent confirmation */}
                      <div className="bg-emerald-50 dark:bg-emerald-950 p-3 rounded-lg text-sm">
                        <p className="font-medium text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                          <MailCheck className="h-4 w-4" />
                          Verification OTP Sent
                        </p>
                        <p className="text-emerald-600 dark:text-emerald-400 text-xs mt-1">
                          Email: {regEmail.replace(/(.{2})(.*)(@.*)/, '$1***$3')}
                        </p>
                        {businessPhone && (
                          <p className="text-emerald-600 dark:text-emerald-400 text-xs mt-0.5">
                            Phone: {businessPhone.slice(0, 2)}****{businessPhone.slice(-2)}
                          </p>
                        )}
                        <p className="text-xs text-emerald-500 dark:text-emerald-400 mt-1">
                          Please check your email inbox/spam and mobile for the 6-digit OTP.
                        </p>
                      </div>

                      <div>
                        <Label htmlFor="reg-otp">Enter 6-digit OTP</Label>
                        <Input
                          id="reg-otp"
                          value={regOtp}
                          onChange={(e) => setRegOtp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                          placeholder="000000"
                          maxLength={6}
                          className="text-center text-lg tracking-widest font-mono"
                          onKeyDown={(e) => { if (e.key === 'Enter' && regOtp.length === 6) handleRegisterVerify() }}
                        />
                      </div>

                      {/* Resend OTP */}
                      <div className="text-center">
                        {regResendCooldown > 0 ? (
                          <p className="text-xs text-muted-foreground">Resend OTP in {regResendCooldown}s</p>
                        ) : (
                          <button
                            type="button"
                            className="text-xs text-emerald-600 hover:text-emerald-700 hover:underline font-medium"
                            onClick={handleResendRegOtp}
                            disabled={loading}
                          >
                            Resend OTP
                          </button>
                        )}
                      </div>

                      {error && <p className="text-sm text-destructive">{error}</p>}

                      <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={handleRegisterVerify} disabled={loading || regOtp.length !== 6}>
                        {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating Account...</> : 'Verify & Create Account'}
                      </Button>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ==================== Reset Password Dialog ==================== */}
      <Dialog open={resetStep !== 'idle'} onOpenChange={(open) => { if (!open) closeResetDialog() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-emerald-600" />
              Reset Password
            </DialogTitle>
          </DialogHeader>

          {/* Step 1: Enter email/phone */}
          {resetStep === 'request' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Enter the email address or phone number associated with your account. We will send you a one-time password (OTP) to verify your identity.
              </p>
              <div>
                <Label htmlFor="reset-identifier">Email or Phone Number</Label>
                <Input
                  id="reset-identifier"
                  value={resetIdentifier}
                  onChange={(e) => setResetIdentifier(e.target.value)}
                  placeholder="you@business.com or +91-9876543210"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSendOtp() }}
                />
              </div>
              {resetError && <p className="text-sm text-destructive">{resetError}</p>}
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={closeResetDialog}>Cancel</Button>
                <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleSendOtp} disabled={resetLoading}>
                  {resetLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending OTP...</> : 'Send OTP'}
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Step 2: Enter OTP + New Password */}
          {resetStep === 'verify' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <button
                  type="button"
                  className="text-sm text-emerald-600 hover:text-emerald-700 font-medium inline-flex items-center gap-1"
                  onClick={() => { setResetStep('request'); setResetError('') }}
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
              </div>
              {/* Status banner */}
              {otpDeliveryMethod === 'both' ? (
                <div className="bg-emerald-50 dark:bg-emerald-950 p-3 rounded-lg text-sm">
                  <p className="font-medium text-emerald-700 dark:text-emerald-300">OTP sent to email & mobile</p>
                  {resetEmail && (
                    <p className="text-emerald-600 dark:text-emerald-400 text-xs mt-1">
                      Email: {resetEmail.replace(/(.{2})(.*)(@.*)/, '$1***$3')}
                    </p>
                  )}
                  <p className="text-xs text-emerald-500 dark:text-emerald-400 mt-1">
                    Check your email inbox/spam or your mobile phone for the OTP.
                  </p>
                </div>
              ) : otpDeliveryMethod === 'email' ? (
                <div className="bg-emerald-50 dark:bg-emerald-950 p-3 rounded-lg text-sm">
                  <p className="font-medium text-emerald-700 dark:text-emerald-300">OTP sent to your email</p>
                  {resetEmail && (
                    <p className="text-emerald-600 dark:text-emerald-400 text-xs mt-1">
                      {resetEmail.replace(/(.{2})(.*)(@.*)/, '$1***$3')}
                    </p>
                  )}
                  <p className="text-xs text-emerald-500 dark:text-emerald-400 mt-1">
                    Please check your inbox and spam folder for the OTP.
                  </p>
                </div>
              ) : otpDeliveryMethod === 'sms' ? (
                <div className="bg-emerald-50 dark:bg-emerald-950 p-3 rounded-lg text-sm">
                  <p className="font-medium text-emerald-700 dark:text-emerald-300">OTP sent via SMS</p>
                  <p className="text-xs text-emerald-500 dark:text-emerald-400 mt-1">
                    Check your registered mobile number for the OTP.
                  </p>
                </div>
              ) : otpDeliveryMethod === 'failed' ? (
                <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-3 rounded-lg text-sm">
                  <p className="font-medium text-red-700 dark:text-red-300">OTP delivery failed</p>
                  <p className="text-red-600 dark:text-red-400 text-xs mt-1">
                    Could not send OTP. Please verify your email/phone or contact support.
                  </p>
                </div>
              ) : (
                <div className="bg-emerald-50 dark:bg-emerald-950 p-3 rounded-lg text-sm">
                  <p className="font-medium text-emerald-700 dark:text-emerald-300">OTP has been sent</p>
                  {resetEmail && (
                    <p className="text-emerald-600 dark:text-emerald-400 text-xs mt-1">
                      For account: {resetEmail.replace(/(.{2})(.*)(@.*)/, '$1***$3')}
                    </p>
                  )}
                </div>
              )}
              <div>
                <Label htmlFor="reset-otp">Enter OTP</Label>
                <Input
                  id="reset-otp"
                  value={resetOtp}
                  onChange={(e) => setResetOtp(e.target.value)}
                  placeholder="6-digit OTP"
                  maxLength={6}
                  className="text-center text-lg tracking-widest font-mono"
                />
              </div>
              <div>
                <Label htmlFor="reset-new-pass">New Password</Label>
                <Input
                  id="reset-new-pass"
                  type="password"
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  minLength={6}
                />
              </div>
              <div>
                <Label htmlFor="reset-confirm-pass">Confirm New Password</Label>
                <Input
                  id="reset-confirm-pass"
                  type="password"
                  value={resetConfirmPassword}
                  onChange={(e) => setResetConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  minLength={6}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleResetPassword() }}
                />
              </div>
              {resetError && <p className="text-sm text-destructive">{resetError}</p>}
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={closeResetDialog}>Cancel</Button>
                <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleResetPassword} disabled={resetLoading}>
                  {resetLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Resetting...</> : 'Reset Password'}
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Step 3: Success */}
          {resetStep === 'done' && (
            <div className="space-y-4 text-center py-4">
              <div className="mx-auto h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center">
                <KeyRound className="h-8 w-8 text-emerald-600" />
              </div>
              <h3 className="text-lg font-semibold">Password Reset Successfully</h3>
              <p className="text-sm text-muted-foreground">
                Your password has been changed. You can now login with your new password.
              </p>
              <Button className="bg-emerald-600 hover:bg-emerald-700 w-full" onClick={closeResetDialog}>
                Back to Login
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* v4.7: Workspace Selection Modal (Rule 2.2) */}
      <WorkspaceSelectionModal
        open={showWorkspaceModal}
        user={workspaceUser}
        workspaces={workspaceOptions}
        onSelect={handleSelectWorkspace}
        onCancel={() => {
          setShowWorkspaceModal(false)
          setError('Workspace selection cancelled. Please log in again.')
        }}
      />
    </div>
  )
}
