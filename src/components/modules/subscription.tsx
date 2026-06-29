'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/store/app-store'
import { authFetch } from '@/lib/auth-fetch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Clock, Zap, Crown, Check, AlertCircle, TrendingUp, Users, Sparkles, Loader2, Receipt, UserPlus, Shield, ShieldCheck } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface Plan {
  hours: number
  name: string
  mrp: number
  discountPercent: number
  discountAmount: number
  finalPrice: number
  totalSeconds: number
  roleAllocation: {
    MAIN_ADMIN: number
    JUNIOR_ADMIN: number
    DATA_ENTRY: number
    VIEW_ONLY: number
  }
}

interface SubscriptionData {
  subscription: {
    id: string
    planHours: number
    planName: string
    remainingHours: number
    remainingMinutes: number
    status: string
    isFreeTier: boolean
    freeTierHours: number
    mainAdminHours: number
    juniorAdminHours: number
    dataEntryHours: number
    viewOnlyHours: number
  }
  recharges: Array<{
    id: string
    planName: string
    planHours: number
    mrp: number
    paymentMode: string
    status: string
    createdAt: string
  }>
  availablePlans: Plan[]
}

export function SubscriptionPage() {
  const { tenant } = useAppStore()
  const { toast } = useToast()
  const [data, setData] = useState<SubscriptionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [rechargePlan, setRechargePlan] = useState<Plan | null>(null)
  const [recharging, setRecharging] = useState(false)
  const [extraIdPurchase, setExtraIdPurchase] = useState<{ cost: number } | null>(null)
  const [paymentMethod] = useState<'razorpay'>('razorpay') // v4.140: Razorpay only

  const load = async () => {
    if (!tenant) return
    setLoading(true)
    try {
      const res = await authFetch('/api/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-status', tenantId: tenant.id }),
      })
      if (res.ok) {
        const d = await res.json()
        setData(d)
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [tenant])

  const handleRecharge = async () => {
    if (!tenant || !rechargePlan) return
    setRecharging(true)
    try {
      // Step 1: Create a Razorpay order (or get MANUAL mode)
      const orderRes = await authFetch('/api/razorpay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-order',
          tenantId: tenant.id,
          planHours: rechargePlan.hours,
        }),
      })
      const orderData = await orderRes.json()

      if (!orderRes.ok) {
        toast({ title: 'Error', description: orderData.error || 'Failed to create order', variant: 'destructive' })
        return
      }

      // If Razorpay is not configured, fall back to manual activation
      if (orderData.mode === 'MANUAL') {
        const rechargeRes = await authFetch('/api/subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'recharge',
            tenantId: tenant.id,
            planHours: rechargePlan.hours,
            paymentMode: 'MANUAL',
          }),
        })
        const d = await rechargeRes.json()
        if (rechargeRes.ok) {
          toast({ title: 'Recharge Successful!', description: d.message })
          setRechargePlan(null)
          load()
        } else {
          toast({ title: 'Error', description: d.error || 'Recharge failed', variant: 'destructive' })
        }
        return
      }

      // Step 2: Open Razorpay checkout
      const razorpayKey = orderData.keyId
      const options: any = {
        key: razorpayKey,
        amount: orderData.amount,
        currency: orderData.currency,
        name: 'BizBook Pro',
        description: `Recharge — ${orderData.plan.name}`,
        image: '/logo.png',
        order_id: orderData.orderId,
        prefill: {
          name: orderData.prefill?.name || '',
          email: orderData.prefill?.email || '',
        },
        theme: { color: '#059669' },
        handler: async (response: any) => {
          // Step 3: Verify payment on server
          try {
            const verifyRes = await authFetch('/api/razorpay', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'verify-payment',
                tenantId: tenant.id,
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
                planHours: rechargePlan.hours,
              }),
            })
            const verifyData = await verifyRes.json()
            if (verifyRes.ok && verifyData.success) {
              toast({ title: 'Payment Successful!', description: verifyData.message, duration: 6000 })
              setRechargePlan(null)
              load()
            } else {
              toast({ title: 'Payment Verification Failed', description: verifyData.error || 'Please contact support', variant: 'destructive', duration: 8000 })
            }
          } catch {
            toast({ title: 'Error', description: 'Payment verification failed. Please contact support.', variant: 'destructive' })
          }
        },
        modal: {
          ondismiss: () => {
            toast({ title: 'Payment Cancelled', description: 'You closed the payment window.' })
          },
        },
      }

      // Open Razorpay checkout
      const rzp = new (window as any).Razorpay(options)
      rzp.on('payment.failed', (err: any) => {
        toast({ title: 'Payment Failed', description: err.error?.description || 'Payment was not completed.', variant: 'destructive' })
      })
      rzp.open()
    } catch {
      toast({ title: 'Error', description: 'Network error', variant: 'destructive' })
    } finally {
      setRecharging(false)
    }
  }

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    )
  }

  const sub = data.subscription
  const totalHours = sub.remainingHours + sub.remainingMinutes / 60
  const usedPercent = sub.isFreeTier
    ? Math.round(((sub.freeTierHours - totalHours) / sub.freeTierHours) * 100)
    : 0

  return (
    <div className="space-y-6">
      {/* Current Plan Status */}
      <Card className="border-0 shadow-lg bg-gradient-to-br from-emerald-600 to-teal-700 text-white">
        <CardContent className="pt-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                {sub.isFreeTier ? (
                  <Badge className="bg-white/20 text-white border-0">FREE TIER</Badge>
                ) : (
                  <Badge className="bg-yellow-400 text-yellow-900 border-0">PREMIUM</Badge>
                )}
                <Badge className="bg-white/20 text-white border-0">{sub.status}</Badge>
              </div>
              <h2 className="text-2xl font-bold">{sub.planName}</h2>
              <p className="text-emerald-100 text-sm mt-1">
                {sub.isFreeTier
                  ? `Free ${sub.freeTierHours} hours for new users`
                  : 'Active subscription'}
              </p>
            </div>
            <div className="text-right">
              <div className="text-4xl font-bold">{sub.remainingHours}h</div>
              <div className="text-emerald-100 text-sm">{sub.remainingMinutes}m remaining</div>
            </div>
          </div>

          {sub.isFreeTier && sub.freeTierHours > 0 && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-emerald-100 mb-1">
                <span>Used: {sub.freeTierHours - totalHours}h</span>
                <span>Total: {sub.freeTierHours}h</span>
              </div>
              <Progress value={usedPercent} className="h-2 bg-white/20" />
            </div>
          )}

          {/* v4.134: Merged Junior Admin + Data Entry into one "Non-View-Only Users" card */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-6">
            <RoleCard icon={<Crown className="h-4 w-4" />} label="Main Admin" hours={sub.mainAdminHours} color="text-yellow-300" />
            <RoleCard icon={<Users className="h-4 w-4" />} label="Non-View Users" hours={(sub.juniorAdminHours || 0) + (sub.dataEntryHours || 0)} color="text-blue-200" />
            <RoleCard icon={<Check className="h-4 w-4" />} label="View Only" hours={0} color="text-gray-300" suffix="Free" />
          </div>
        </CardContent>
      </Card>

      {/* Available Plans */}
      <div>
        <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-emerald-600" />
          Recharge Plans
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Choose a plan to extend your usage hours. Higher plans offer better per-hour rates.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.availablePlans.map((plan) => {
            const finalPrice = plan.discountAmount  // discountAmount IS the final price customer pays
            const perHour = (finalPrice / plan.hours).toFixed(1)
            const isPopular = plan.hours === 200
            return (
              <Card
                key={plan.hours}
                className={`relative transition-all ${
                  isPopular ? 'border-emerald-500 border-2 shadow-md' : 'border'
                }`}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-emerald-600 text-white">MOST POPULAR</Badge>
                  </div>
                )}
                <CardContent className="pt-6">
                  <div className="text-center mb-4">
                    <div className="flex items-center justify-center gap-1 mb-1">
                      <Clock className="h-5 w-5 text-emerald-600" />
                      <span className="text-2xl font-bold">{plan.hours}h</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{plan.name}</p>
                  </div>

                  <div className="text-center mb-4">
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-2xl font-bold text-emerald-600">₹{finalPrice}</span>
                      <span className="text-sm text-muted-foreground line-through">₹{plan.mrp}</span>
                    </div>
                    <Badge variant="secondary" className="mt-1 text-xs">
                      {plan.discountPercent}% OFF · ₹{perHour}/hr
                    </Badge>
                  </div>

                  <div className="space-y-1 text-xs">
                    <RoleLine label="Main Admin" hours={plan.roleAllocation.MAIN_ADMIN} />
                    <RoleLine label="Non-View Users" hours={plan.roleAllocation.JUNIOR_ADMIN + plan.roleAllocation.DATA_ENTRY} />
                    <RoleLine label="View Only" hours={0} suffix="Free" />
                  </div>

                  <Button
                    className="w-full mt-4 bg-blue-600 hover:bg-blue-700"
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); setRechargePlan(plan) }}
                  >
                    Choose Plan — ₹{finalPrice}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      {/* Recharge History */}
      {data.recharges.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Receipt className="h-4 w-4" /> Recharge History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.recharges.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="text-sm font-medium">{r.planName}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleDateString('en-IN')} · {r.paymentMode}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">₹{r.mrp - (data.availablePlans.find(p => p.name === r.planName)?.discountAmount || 0)}</p>
                    <Badge variant={r.status === 'COMPLETED' ? 'default' : 'secondary'} className="text-xs">
                      {r.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Free Tier Info Banner */}
      {sub.isFreeTier && (
        <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950 border-blue-200 dark:border-blue-900">
          <CardContent className="pt-4 flex items-start gap-3">
            <TrendingUp className="h-5 w-5 text-blue-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                You're on the Free Tier — {sub.freeTierHours} hours free!
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                {sub.freeTierHours === 100 && 'You registered early! Enjoy 100 free hours.'}
                {sub.freeTierHours === 50 && 'You have 50 free hours as an early user.'}
                {sub.freeTierHours === 20 && 'You have 20 free hours to try BizBook Pro.'}
                {' '}When your free hours run out, upgrade to any plan above to continue. View Only access is always free.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* v4.97: Extra IDs Section */}
      <Card className="border-violet-200 dark:border-violet-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <UserPlus className="h-5 w-5 text-violet-600" />
            Extra User IDs
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Each plan includes 1 Main Admin, 1 Junior Admin, 1 Data Entry, and unlimited View Only users.
            Need more? Add extra IDs below.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current slots */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-muted/50 p-3 rounded-lg text-center">
              <Shield className="h-5 w-5 mx-auto text-emerald-600 mb-1" />
              <p className="text-xs text-muted-foreground">Main Admin</p>
              <p className="text-lg font-bold">1</p>
              <p className="text-[10px] text-muted-foreground">Included</p>
            </div>
            <div className="bg-muted/50 p-3 rounded-lg text-center">
              <Users className="h-5 w-5 mx-auto text-blue-600 mb-1" />
              <p className="text-xs text-muted-foreground">Junior Admin</p>
              <p className="text-lg font-bold">1 + {(sub as any).extraJuniorAdminSlots || 0}</p>
              <p className="text-[10px] text-muted-foreground">{(sub as any).extraJuniorAdminSlots || 0} extra</p>
            </div>
            <div className="bg-muted/50 p-3 rounded-lg text-center">
              <Users className="h-5 w-5 mx-auto text-amber-600 mb-1" />
              <p className="text-xs text-muted-foreground">Data Entry</p>
              <p className="text-lg font-bold">1 + {(sub as any).extraDataEntrySlots || 0}</p>
              <p className="text-[10px] text-muted-foreground">{(sub as any).extraDataEntrySlots || 0} extra</p>
            </div>
            <div className="bg-muted/50 p-3 rounded-lg text-center">
              <Users className="h-5 w-5 mx-auto text-slate-500 mb-1" />
              <p className="text-xs text-muted-foreground">View Only</p>
              <p className="text-lg font-bold">∞</p>
              <p className="text-[10px] text-muted-foreground">Always Free</p>
            </div>
          </div>

          {/* Pricing info */}
          <div className="bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-900 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 text-violet-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-violet-900 dark:text-violet-200">
                <p className="font-semibold mb-1">Extra ID Pricing</p>
                <p>• Cost: <strong>₹149 per ID</strong> (Junior Admin or Data Entry)</p>
                <p>• Recharge increase: <strong>15% of current plan MRP</strong> ({(sub as any).mrp ? `₹${Math.round((sub as any).mrp * 0.15)}` : '₹0 for Free Tier'}) per extra ID</p>
                <p className="text-xs text-violet-700 dark:text-violet-400 mt-1">Extra IDs are permanent for your subscription. Recharge increase applies to all future recharges.</p>
              </div>
            </div>
          </div>

          {/* v4.132: Single "Add Extra ID" button — no separate Junior/Data Entry */}
          <div className="flex justify-center">
            <Button
              variant="outline"
              className="h-auto py-4 px-8 border-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950"
              onClick={() => setExtraIdPurchase({ cost: 149 })}
            >
              <div className="flex flex-col items-center gap-1">
                <UserPlus className="h-6 w-6 text-violet-600" />
                <span className="font-semibold">Add Extra ID</span>
                <span className="text-xs text-muted-foreground">₹149 one-time · +15% on all recharges</span>
              </div>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* v4.140: Recharge Dialog — Razorpay only (UPI manual removed) */}
      <Dialog open={!!rechargePlan} onOpenChange={(open) => !open && setRechargePlan(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Recharge</DialogTitle>
          </DialogHeader>
          {rechargePlan && (() => {
            const maxUsers = (sub as any)?.maxUsersAllowed || 0
            const extraIds = maxUsers > 3 ? maxUsers - 3 : 0
            const surcharge = extraIds > 0 ? Math.round(rechargePlan.finalPrice * 0.15) : 0
            const baseTotal = rechargePlan.finalPrice + surcharge
            const rzpFee = Math.round(baseTotal * 0.02 * 100) / 100
            const rzpGst = Math.round(rzpFee * 0.18 * 100) / 100
            const rzpTotal = Math.round((baseTotal + rzpFee + rzpGst) * 100) / 100

            return (
              <div className="space-y-4">
                {/* Plan summary */}
                <div className="bg-emerald-50 dark:bg-emerald-950/30 p-4 rounded-lg text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <Clock className="h-6 w-6 text-emerald-600" />
                    <span className="text-3xl font-bold text-emerald-700 dark:text-emerald-400">
                      {rechargePlan.hours} Hours
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{rechargePlan.name}</p>
                </div>

                {/* Price breakdown */}
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">MRP</span>
                    <span>₹{rechargePlan.mrp}</span>
                  </div>
                  <div className="flex justify-between text-emerald-600">
                    <span>Discount ({rechargePlan.discountPercent}%)</span>
                    <span>−₹{rechargePlan.mrp - rechargePlan.finalPrice}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t pt-2">
                    <span>Base Price</span>
                    <span className="text-emerald-600">₹{rechargePlan.finalPrice}</span>
                  </div>
                  {extraIds > 0 && (
                    <div className="flex justify-between text-violet-600">
                      <span>+15% surcharge ({extraIds} extra ID{extraIds > 1 ? 's' : ''})</span>
                      <span>+₹{surcharge}</span>
                    </div>
                  )}
                </div>

                {/* Razorpay fee breakdown */}
                <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-xs space-y-1">
                  <div className="flex justify-between text-blue-700 dark:text-blue-400">
                    <span>Subtotal:</span><span>₹{baseTotal}</span>
                  </div>
                  <div className="flex justify-between text-blue-700 dark:text-blue-400">
                    <span>Razorpay fee (2%):</span><span>+₹{rzpFee}</span>
                  </div>
                  <div className="flex justify-between text-blue-700 dark:text-blue-400">
                    <span>GST on fee (18%):</span><span>+₹{rzpGst}</span>
                  </div>
                  <div className="flex justify-between font-bold text-blue-900 dark:text-blue-200 border-t border-blue-200 dark:border-blue-800 pt-1">
                    <span>Total to Pay:</span><span>₹{rzpTotal}</span>
                  </div>
                </div>

                {/* Razorpay info */}
                <div className="bg-blue-50 dark:bg-blue-950/30 p-3 rounded-lg text-xs text-blue-800 dark:text-blue-300">
                  <ShieldCheck className="h-4 w-4 inline mr-1" />
                  You'll be redirected to Razorpay's secure payment page. Cards, UPI, wallets, and net banking accepted. Payment is auto-verified instantly — no manual approval needed.
                </div>
              </div>
            )
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRechargePlan(null)}>Cancel</Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              disabled={recharging}
              onClick={async () => {
                if (!tenant || !rechargePlan) return
                setRecharging(true)
                try {
                  const orderRes = await authFetch('/api/razorpay', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'create-order', tenantId: tenant.id, planHours: rechargePlan.hours, purpose: 'recharge' }),
                  })
                  const orderData = await orderRes.json()
                  if (!orderRes.ok) { toast({ title: 'Error', description: orderData.error, variant: 'destructive' }); return }
                  const options: any = {
                    key: orderData.keyId, amount: orderData.amount, currency: 'INR',
                    name: 'BizBook Pro', description: orderData.planName, order_id: orderData.orderId,
                    prefill: { name: orderData.prefill?.name || '', email: orderData.prefill?.email || '' },
                    theme: { color: '#2563eb' },
                    handler: async (response: any) => {
                      try {
                        const vRes = await authFetch('/api/razorpay', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'verify-payment', tenantId: tenant.id, razorpayOrderId: response.razorpay_order_id, razorpayPaymentId: response.razorpay_payment_id, razorpaySignature: response.razorpay_signature, planHours: rechargePlan.hours, purpose: 'recharge' }),
                        })
                        const vData = await vRes.json()
                        if (vRes.ok && vData.success) { toast({ title: 'Payment Successful!', description: vData.message, duration: 6000 }); setRechargePlan(null); load() }
                        else { toast({ title: 'Verification Failed', description: vData.error, variant: 'destructive', duration: 8000 }) }
                      } catch { toast({ title: 'Error', description: 'Verification failed.', variant: 'destructive' }) }
                    },
                    modal: { ondismiss: () => { toast({ title: 'Payment Cancelled' }) } },
                  }
                  const rzp = new (window as any).Razorpay(options)
                  rzp.on('payment.failed', (err: any) => { toast({ title: 'Payment Failed', description: err.error?.description, variant: 'destructive' }) })
                  rzp.open()
                } catch { toast({ title: 'Network error', variant: 'destructive' }) }
                finally { setRecharging(false) }
              }}
            >
              {recharging ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1" />}
              Pay via Razorpay
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* v4.140: UPI Checkout Modal removed — Razorpay only now */}

      {/* v4.142: Extra ID Payment Dialog — Razorpay only */}
      <Dialog open={!!extraIdPurchase} onOpenChange={(open) => !open && setExtraIdPurchase(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-violet-600" />
              Add Extra ID
            </DialogTitle>
          </DialogHeader>
          {extraIdPurchase && (() => {
            const basePrice = extraIdPurchase.cost // ₹149
            const rzpFee = Math.round(basePrice * 0.02 * 100) / 100
            const rzpGst = Math.round(rzpFee * 0.18 * 100) / 100
            const rzpTotal = Math.round((basePrice + rzpFee + rzpGst) * 100) / 100

            return (
              <div className="space-y-4">
                {/* Pricing summary */}
                <div className="bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-900 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Extra ID (Non-View-Only):</span>
                    <span className="font-semibold">1 ID</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">One-time Cost:</span>
                    <span className="font-semibold">₹{basePrice}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Recharge Surcharge:</span>
                    <span className="font-semibold">+15% on all future recharges</span>
                  </div>
                </div>

                {/* Razorpay fee breakdown */}
                <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-xs space-y-1">
                  <div className="flex justify-between text-blue-700 dark:text-blue-400">
                    <span>Base Price:</span><span>₹{basePrice}</span>
                  </div>
                  <div className="flex justify-between text-blue-700 dark:text-blue-400">
                    <span>Razorpay fee (2%):</span><span>+₹{rzpFee}</span>
                  </div>
                  <div className="flex justify-between text-blue-700 dark:text-blue-400">
                    <span>GST on fee (18%):</span><span>+₹{rzpGst}</span>
                  </div>
                  <div className="flex justify-between font-bold text-blue-900 dark:text-blue-200 border-t border-blue-200 dark:border-blue-800 pt-1">
                    <span>Total to Pay:</span><span>₹{rzpTotal}</span>
                  </div>
                </div>

                {/* Razorpay info */}
                <div className="bg-blue-50 dark:bg-blue-950/30 p-3 rounded-lg text-xs text-blue-800 dark:text-blue-300">
                  <ShieldCheck className="h-4 w-4 inline mr-1" />
                  You'll be redirected to Razorpay's secure payment page. Cards, UPI, wallets, and net banking accepted. Payment is auto-verified instantly.
                </div>
              </div>
            )
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtraIdPurchase(null)}>Cancel</Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              disabled={recharging}
              onClick={async () => {
                if (!tenant || !extraIdPurchase) return
                setRecharging(true)
                try {
                  const orderRes = await authFetch('/api/razorpay', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'create-order', tenantId: tenant.id, purpose: 'extra-id' }),
                  })
                  const orderData = await orderRes.json()
                  if (!orderRes.ok) { toast({ title: 'Error', description: orderData.error, variant: 'destructive' }); return }
                  const options: any = {
                    key: orderData.keyId, amount: orderData.amount, currency: 'INR',
                    name: 'BizBook Pro', description: 'Extra ID', order_id: orderData.orderId,
                    prefill: { name: orderData.prefill?.name || '', email: orderData.prefill?.email || '' },
                    theme: { color: '#2563eb' },
                    handler: async (response: any) => {
                      try {
                        const vRes = await authFetch('/api/razorpay', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'verify-payment', tenantId: tenant.id, razorpayOrderId: response.razorpay_order_id, razorpayPaymentId: response.razorpay_payment_id, razorpaySignature: response.razorpay_signature, purpose: 'extra-id' }),
                        })
                        const vData = await vRes.json()
                        if (vRes.ok && vData.success) { toast({ title: 'Extra ID Activated!', description: vData.message, duration: 6000 }); setExtraIdPurchase(null); load() }
                        else { toast({ title: 'Verification Failed', description: vData.error, variant: 'destructive', duration: 8000 }) }
                      } catch { toast({ title: 'Error', description: 'Verification failed.', variant: 'destructive' }) }
                    },
                    modal: { ondismiss: () => { toast({ title: 'Payment Cancelled' }) } },
                  }
                  const rzp = new (window as any).Razorpay(options)
                  rzp.on('payment.failed', (err: any) => { toast({ title: 'Payment Failed', description: err.error?.description, variant: 'destructive' }) })
                  rzp.open()
                } catch { toast({ title: 'Network error', variant: 'destructive' }) }
                finally { setRecharging(false) }
              }}
            >
              {recharging ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1" />}
              Pay via Razorpay
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RoleCard({ icon, label, hours, color, suffix }: {
  icon: React.ReactNode
  label: string
  hours: number
  color: string
  suffix?: string
}) {
  return (
    <div className="bg-white/10 rounded-lg p-3 text-center">
      <div className={`flex justify-center mb-1 ${color}`}>{icon}</div>
      <div className="text-xs text-emerald-100">{label}</div>
      <div className="text-lg font-bold">
        {suffix || `${hours}h`}
      </div>
    </div>
  )
}

function RoleLine({ label, hours, suffix }: { label: string; hours: number; suffix?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{suffix || `${hours}h`}</span>
    </div>
  )
}
