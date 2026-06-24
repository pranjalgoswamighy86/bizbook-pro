'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/store/app-store'
import { authFetch } from '@/lib/auth-fetch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { UPICheckoutModal } from '@/components/app/upi-checkout-modal'
import { Clock, Zap, Crown, Check, AlertCircle, TrendingUp, Users, Sparkles, Loader2, Receipt, UserPlus, Shield } from 'lucide-react'
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
  const [upiPlan, setUpiPlan] = useState<Plan | null>(null)

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

          {/* Role-based allocation */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            <RoleCard icon={<Crown className="h-4 w-4" />} label="Main Admin" hours={sub.mainAdminHours} color="text-yellow-300" />
            <RoleCard icon={<Users className="h-4 w-4" />} label="Junior Admin" hours={sub.juniorAdminHours} color="text-blue-200" />
            <RoleCard icon={<Zap className="h-4 w-4" />} label="Data Entry" hours={sub.dataEntryHours} color="text-emerald-200" />
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
                    <RoleLine label="Junior Admin" hours={plan.roleAllocation.JUNIOR_ADMIN} />
                    <RoleLine label="Data Entry" hours={plan.roleAllocation.DATA_ENTRY} />
                    <RoleLine label="View Only" hours={0} suffix="Free" />
                  </div>

                  <Button
                    className="w-full mt-4 bg-emerald-600 hover:bg-emerald-700"
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); setUpiPlan(plan) }}
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

          {/* Add Extra ID buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button
              variant="outline"
              className="h-auto py-4 border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950"
              onClick={async () => {
                const res = await authFetch('/api/subscription', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'add-extra-id', tenantId: tenant?.id, roleType: 'JUNIOR_ADMIN' }),
                })
                if (res.ok) {
                  const data = await res.json()
                  toast({ title: 'Extra Junior Admin ID Added', description: `Cost: ₹149. Recharge increase: ₹${data.details?.rechargeIncrease || 0}. Total Junior Admin slots: ${data.details?.totalJuniorAdminSlots || 1}`, duration: 6000 })
                  load()
                } else {
                  const err = await res.json().catch(() => ({}))
                  toast({ title: 'Error', description: err.error || 'Failed to add extra ID', variant: 'destructive' })
                }
              }}
            >
              <div className="flex flex-col items-center gap-1">
                <UserPlus className="h-6 w-6 text-blue-600" />
                <span className="font-semibold">Add Junior Admin ID</span>
                <span className="text-xs text-muted-foreground">₹149 · +15% recharge</span>
              </div>
            </Button>
            <Button
              variant="outline"
              className="h-auto py-4 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950"
              onClick={async () => {
                const res = await authFetch('/api/subscription', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'add-extra-id', tenantId: tenant?.id, roleType: 'DATA_ENTRY' }),
                })
                if (res.ok) {
                  const data = await res.json()
                  toast({ title: 'Extra Data Entry ID Added', description: `Cost: ₹149. Recharge increase: ₹${data.details?.rechargeIncrease || 0}. Total Data Entry slots: ${data.details?.totalDataEntrySlots || 1}`, duration: 6000 })
                  load()
                } else {
                  const err = await res.json().catch(() => ({}))
                  toast({ title: 'Error', description: err.error || 'Failed to add extra ID', variant: 'destructive' })
                }
              }}
            >
              <div className="flex flex-col items-center gap-1">
                <UserPlus className="h-6 w-6 text-amber-600" />
                <span className="font-semibold">Add Data Entry ID</span>
                <span className="text-xs text-muted-foreground">₹149 · +15% recharge</span>
              </div>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recharge Confirmation Dialog */}
      <Dialog open={!!rechargePlan} onOpenChange={(open) => !open && setRechargePlan(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Recharge</DialogTitle>
          </DialogHeader>
          {rechargePlan && (
            <div className="space-y-4">
              <div className="bg-emerald-50 dark:bg-emerald-950/30 p-4 rounded-lg text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Clock className="h-6 w-6 text-emerald-600" />
                  <span className="text-3xl font-bold text-emerald-700 dark:text-emerald-400">
                    {rechargePlan.hours} Hours
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{rechargePlan.name}</p>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">MRP</span>
                  <span>₹{rechargePlan.mrp}</span>
                </div>
                <div className="flex justify-between text-emerald-600">
                  <span>Discount ({rechargePlan.discountPercent}%)</span>
                  <span>−₹{rechargePlan.discountAmount}</span>
                </div>
                <div className="flex justify-between font-bold text-lg border-t pt-2">
                  <span>You Pay</span>
                  <span className="text-emerald-600">₹{rechargePlan.finalPrice}</span>
                </div>
              </div>

              <div className="bg-amber-50 dark:bg-amber-950/30 p-3 rounded-lg text-xs text-amber-800 dark:text-amber-200">
                <AlertCircle className="h-4 w-4 inline mr-1" />
                Payment integration (Razorpay) will be available soon. For now, recharges are processed manually by the administrator.
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRechargePlan(null)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={handleRecharge}
              disabled={recharging}
            >
              {recharging ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Activate Plan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* === UPI Checkout Modal (Zero-Cost Autonomous Payment) === */}
      {upiPlan && tenant && (
        <UPICheckoutModal
          open={!!upiPlan}
          onClose={() => setUpiPlan(null)}
          onSuccess={() => { load() }}
          tenantId={tenant.id}
          planHours={upiPlan.hours}
          planName={upiPlan.name}
        />
      )}
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
