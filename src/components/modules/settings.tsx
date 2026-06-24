'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAppStore, canManage, getRoleLabel, type UserRole } from '@/store/app-store'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Settings, Users, Building2, Crown, KeyRound, Loader2, ArrowLeft, Eye, EyeOff, RefreshCw, Database, Info, Trash2, Download, Activity } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { formatDate } from '@/lib/formulas'
import { authFetch } from '@/lib/auth-fetch'

interface UserRecord {
  id: string; email: string; name: string; role: string; isActive: boolean; createdAt: string
}

type PasswordResetStep = 'idle' | 'request' | 'verify' | 'done'
type PasswordChangeStep = 'idle' | 'form' | 'done'

export function SettingsPage() {
  const { tenant, user, setTenant } = useAppStore()
  const { toast } = useToast()
  const [users, setUsers] = useState<UserRecord[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [showAddUser, setShowAddUser] = useState(false)
  const [showEditBiz, setShowEditBiz] = useState(false)
  const [showEditUser, setShowEditUser] = useState(false)
  const [editUserTarget, setEditUserTarget] = useState<UserRecord | null>(null)
  const [editUserRole, setEditUserRole] = useState<string>('DATA_ENTRY')
  const [editUserLoading, setEditUserLoading] = useState(false)
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'DATA_ENTRY' })
  // v4.66: Staff Activity state
  const [activityLogs, setActivityLogs] = useState<any[]>([])
  const [activityUsers, setActivityUsers] = useState<Array<{ id: string; name: string | null; email: string }>>([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityUser, setActivityUser] = useState('all')
  const [activityType, setActivityType] = useState('all')
  const [activityEntity, setActivityEntity] = useState('all')
  const [activityPage, setActivityPage] = useState(1)
  const [activityTotal, setActivityTotal] = useState(0)
  const activityPageSize = 25
  const [bizForm, setBizForm] = useState({ name: '', address: '', phone: '', email: '', gstNumber: '', panNumber: '', upiId: '' })

  // --- About Tab State ---
  const [dbStats, setDbStats] = useState<Record<string, number>>({})
  const [dbPath, setDbPath] = useState('')
  const [tenantCreatedAt, setTenantCreatedAt] = useState('')

  // --- Change Password (know current password) ---
  const [changeStep, setChangeStep] = useState<PasswordChangeStep>('idle')
  const [currentPassword, setCurrentPassword] = useState('')
  const [changeNewPassword, setChangeNewPassword] = useState('')
  const [changeConfirmPassword, setChangeConfirmPassword] = useState('')
  const [changeLoading, setChangeLoading] = useState(false)
  const [changeError, setChangeError] = useState('')
  const [showCurrentPass, setShowCurrentPass] = useState(false)
  const [showNewPass, setShowNewPass] = useState(false)

  // --- Reset Password (forgot password - OTP flow) ---
  const [resetStep, setResetStep] = useState<PasswordResetStep>('idle')
  const [resetIdentifier, setResetIdentifier] = useState('')
  const [resetEmail, setResetEmail] = useState('')
  const [resetOtp, setResetOtp] = useState('')
  const [resetNewPassword, setResetNewPassword] = useState('')
  const [resetConfirmPassword, setResetConfirmPassword] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [resetError, setResetError] = useState('')
  const [otpDeliveryMethod, setOtpDeliveryMethod] = useState<'email' | 'sms' | 'both' | 'failed' | 'unknown'>('unknown')

  // --- Load users function (reusable) ---
  const loadUsers = useCallback(async () => {
    if (!tenant) return
    setUsersLoading(true)
    try {
      const res = await authFetch('/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list-users', tenantId: tenant.id }),
      })
      if (res.ok) {
        const data = await res.json()
        setUsers(data.users || [])
      } else {
        toast({ title: 'Error', description: 'Failed to load users', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Network error loading users', variant: 'destructive' })
    } finally {
      setUsersLoading(false)
    }
  }, [tenant, toast])

  // v4.66: Load staff activity (company-wise, MAIN_ADMIN only)
  const loadActivity = useCallback(async () => {
    if (!tenant) return
    setActivityLoading(true)
    try {
      const body: Record<string, unknown> = { action: 'list', tenantId: tenant.id, page: activityPage, pageSize: activityPageSize }
      if (activityUser !== 'all') body.userId = activityUser
      if (activityType !== 'all') body.actionType = activityType
      if (activityEntity !== 'all') body.entityType = activityEntity

      const res = await authFetch('/api/audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        setActivityLogs(data.logs || [])
        setActivityTotal(data.total || 0)
        // Build unique user list from logs
        const userMap = new Map()
        ;(data.logs || []).forEach((log: any) => {
          if (log.userId && !userMap.has(log.userId)) {
            userMap.set(log.userId, { id: log.userId, name: log.userName, email: '' })
          }
        })
        // Merge with users list
        users.forEach(u => {
          if (!userMap.has(u.id)) userMap.set(u.id, { id: u.id, name: u.name, email: u.email })
        })
        setActivityUsers(Array.from(userMap.values()))
      }
    } catch (err) {
      // Silent fail
    } finally {
      setActivityLoading(false)
    }
  }, [tenant, activityPage, activityUser, activityType, activityEntity, users])

  // Load activity when tab is first opened or filters change
  useEffect(() => {
    loadActivity()
  }, [loadActivity])

  // --- Load About tab data ---
  const loadAboutData = useCallback(async () => {
    if (!tenant) return
    try {
      const res = await authFetch('/api/db-admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stats' }),
      })
      if (res.ok) {
        const data = await res.json()
        setDbStats(data.stats || {})
      }
    } catch {
      console.error('Failed to load DB stats')
    }
    // Fetch tenant creation date and db path from a dedicated endpoint
    try {
      const res = await authFetch('/api/tenants', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get-info', tenantId: tenant.id }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.createdAt) setTenantCreatedAt(data.createdAt)
        if (data.dbPath) setDbPath(data.dbPath)
      }
    } catch {
      // Fallback
      if (tenant) {
        setDbPath('/home/z/my-project/db/custom.db')
      }
    }
  }, [tenant])

  useEffect(() => {
    if (!tenant) return
    loadUsers()
    setBizForm({ name: tenant.name, address: tenant.address || '', phone: tenant.phone || '', email: tenant.email || '', gstNumber: tenant.gstNumber || '', panNumber: tenant.panNumber || '', upiId: tenant.upiId || '' })
    loadAboutData()
  }, [tenant, loadUsers, loadAboutData])

  const handleAddUser = async () => {
    if (!tenant) return
    if (!newUser.name.trim() || !newUser.email.trim() || !newUser.password) {
      toast({ title: 'All fields required', description: 'Name, email, and password are required.', variant: 'destructive' })
      return
    }
    const res = await authFetch('/api/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add-user', tenantId: tenant.id, ...newUser }),
    })
    if (res.ok) {
      toast({ title: 'User added successfully' })
      setShowAddUser(false)
      setNewUser({ name: '', email: '', password: '', role: 'DATA_ENTRY' })
      loadUsers() // Refresh users list
    } else {
      const errData = await res.json().catch(() => ({}))
      toast({ title: errData.error || 'Error adding user', description: errData.error || 'Please check the details and try again.', variant: 'destructive' })
    }
  }

  const handleUpdateBiz = async () => {
    if (!tenant) return
    const res = await authFetch('/api/tenants', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', id: tenant.id, data: bizForm }),
    })
    if (res.ok) {
      const data = await res.json()
      // v4.103: Update the tenant in the store so UPI ID persists without refresh
      if (data.tenant) {
        setTenant(data.tenant)
      } else {
        // Fallback: update from bizForm
        setTenant({ ...tenant, ...bizForm })
      }
      toast({ title: 'Business details updated', description: 'UPI ID and other changes saved.' })
      setShowEditBiz(false)
    } else {
      const err = await res.json().catch(() => ({}))
      toast({ title: 'Error', description: err.error || 'Failed to update', variant: 'destructive' })
    }
  }

  const handleToggleUser = async (userId: string, currentlyActive: boolean) => {
    if (!tenant) {
      toast({ title: 'Error', description: 'No business selected', variant: 'destructive' })
      return
    }
    const newActive = !currentlyActive
    try {
      const res = await authFetch('/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle-user', userId, isActive: newActive, tenantId: tenant.id }),
      })
      if (res.ok) {
        toast({ title: `User ${newActive ? 'activated' : 'deactivated'}` })
        // Update local state immediately for instant UI feedback
        setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, isActive: newActive } : u))
      } else {
        const data = await res.json().catch(() => ({}))
        toast({ title: 'Error', description: data.error || 'Failed to toggle user', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Network error. Please try again.', variant: 'destructive' })
    }
  }

  // --- Edit User Role ---
  const handleOpenEditUser = (u: UserRecord) => {
    setEditUserTarget(u)
    setEditUserRole(u.role)
    setShowEditUser(true)
  }

  const handleEditUser = async () => {
    if (!tenant || !editUserTarget) return
    setEditUserLoading(true)
    try {
      const res = await authFetch('/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit-user', userId: editUserTarget.id, role: editUserRole, tenantId: tenant.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast({ title: 'User role updated', description: `${editUserTarget.email} is now ${getRoleLabel(editUserRole as UserRole)}` })
        // Update local state
        setUsers((prev) => prev.map((u) => u.id === editUserTarget.id ? { ...u, role: editUserRole } : u))
        setShowEditUser(false)
        setEditUserTarget(null)
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to update user role', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Network error. Please try again.', variant: 'destructive' })
    } finally {
      setEditUserLoading(false)
    }
  }

  // --- Change Password Handler ---
  const handleChangePassword = async () => {
    if (!user) return
    if (!currentPassword) {
      setChangeError('Current password is required')
      return
    }
    if (!changeNewPassword || changeNewPassword.length < 6) {
      setChangeError('New password must be at least 6 characters')
      return
    }
    if (changeNewPassword !== changeConfirmPassword) {
      setChangeError('Passwords do not match')
      return
    }
    if (currentPassword === changeNewPassword) {
      setChangeError('New password must be different from current password')
      return
    }
    setChangeLoading(true)
    setChangeError('')
    try {
      const res = await authFetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'change-password',
          userId: user.id,
          currentPassword,
          newPassword: changeNewPassword,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setChangeError(data.error || 'Failed to change password')
        return
      }
      setChangeStep('done')
      toast({ title: 'Password Changed', description: 'Your password has been updated successfully.' })
    } catch {
      setChangeError('Network error. Please try again.')
    } finally {
      setChangeLoading(false)
    }
  }

  const closeChangeDialog = () => {
    setChangeStep('idle')
    setCurrentPassword('')
    setChangeNewPassword('')
    setChangeConfirmPassword('')
    setChangeError('')
    setChangeLoading(false)
    setShowCurrentPass(false)
    setShowNewPass(false)
  }

  // --- Reset Password Handler ---
  const handleSendOtp = async () => {
    if (!resetIdentifier.trim()) {
      setResetError('Please enter your email or phone number')
      return
    }
    setResetLoading(true)
    setResetError('')
    try {
      const res = await authFetch('/api/auth', {
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
      const res = await authFetch('/api/auth', {
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
      toast({ title: 'Password Reset', description: 'Your password has been reset successfully.' })
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

  if (!canManage(user?.role || 'VIEW_ONLY')) {
    return (
      <div className="p-6">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-8 text-center">
            <Crown className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold">Admin Access Required</h3>
            <p className="text-sm text-muted-foreground">Only Main Admin can access Settings.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 pb-8 space-y-6">
      <h2 className="text-lg font-semibold flex items-center gap-2"><Settings className="h-5 w-5" />Settings</h2>

      <Tabs defaultValue="company" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5 max-w-2xl">
          <TabsTrigger value="company" className="text-xs sm:text-sm">Company</TabsTrigger>
          <TabsTrigger value="users" className="text-xs sm:text-sm">Users</TabsTrigger>
          <TabsTrigger value="activity" className="text-xs sm:text-sm">Staff Activity</TabsTrigger>
          <TabsTrigger value="data" className="text-xs sm:text-sm">Data</TabsTrigger>
          <TabsTrigger value="about" className="text-xs sm:text-sm">About</TabsTrigger>
        </TabsList>

        {/* ==================== Company Profile Tab ==================== */}
        <TabsContent value="company" className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2"><Building2 className="h-4 w-4" />Business Details</CardTitle>
                <Button variant="outline" size="sm" onClick={() => setShowEditBiz(true)}>Edit</Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Name:</span> <span className="font-medium">{tenant?.name}</span></div>
                <div><span className="text-muted-foreground">Phone:</span> <span className="font-medium">{tenant?.phone || '-'}</span></div>
                <div><span className="text-muted-foreground">Email:</span> <span className="font-medium">{tenant?.email || '-'}</span></div>
                <div><span className="text-muted-foreground">GST:</span> <span className="font-medium">{tenant?.gstNumber || '-'}</span></div>
                <div><span className="text-muted-foreground">Address:</span> <span className="font-medium">{tenant?.address || '-'}</span></div>
                <div><span className="text-muted-foreground">Plan:</span> <Badge className="bg-emerald-600">{tenant?.plan || 'Free'}</Badge></div>
              </div>
            </CardContent>
          </Card>

          {/* Password & Security */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><KeyRound className="h-4 w-4" />Password & Security</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 bg-muted/50 p-4 rounded-lg">
                  <h4 className="font-medium text-sm mb-1">Change Password</h4>
                  <p className="text-xs text-muted-foreground mb-3">You know your current password and want to change it.</p>
                  <Button size="sm" variant="outline" onClick={() => { setChangeStep('form'); setChangeError('') }}>
                    <KeyRound className="h-3.5 w-3.5 mr-1.5" /> Change Password
                  </Button>
                </div>
                <div className="flex-1 bg-muted/50 p-4 rounded-lg">
                  <h4 className="font-medium text-sm mb-1">Reset Password</h4>
                  <p className="text-xs text-muted-foreground mb-3">You forgot your password and need to reset it via OTP verification.</p>
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => { setResetStep('request'); setResetError('') }}>
                    <KeyRound className="h-3.5 w-3.5 mr-1.5" /> Reset Password
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Role Descriptions */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Access Roles Explained</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="flex gap-3 p-2 rounded bg-muted/50"><Badge variant="outline">View Only</Badge><span className="text-muted-foreground">Can only view data. Cannot create, edit, or delete any entries.</span></div>
                <div className="flex gap-3 p-2 rounded bg-muted/50"><Badge variant="outline">Data Entry</Badge><span className="text-muted-foreground">Can create new entries. Cannot edit or delete existing entries.</span></div>
                <div className="flex gap-3 p-2 rounded bg-muted/50"><Badge variant="outline">Junior Admin</Badge><span className="text-muted-foreground">Can create, edit, and correct entries. Cannot manage users or settings.</span></div>
                <div className="flex gap-3 p-2 rounded bg-muted/50"><Badge variant="outline">Main Admin</Badge><span className="text-muted-foreground">Full access. Can manage all data, users, settings, and formulas.</span></div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== User Management Tab ==================== */}
        <TabsContent value="users" className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4" />User Management</CardTitle>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={loadUsers} disabled={usersLoading}>
                    <RefreshCw className={`h-3.5 w-3.5 mr-1 ${usersLoading ? 'animate-spin' : ''}`} /> Refresh
                  </Button>
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setShowAddUser(true)}>Add User</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {usersLoading && users.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
                </div>
              ) : users.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No users found</p>
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 mt-3" onClick={() => setShowAddUser(true)}>Add User</Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {users.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell className="font-medium">{u.name}</TableCell>
                          <TableCell>{u.email}</TableCell>
                          <TableCell><Badge variant="outline">{getRoleLabel(u.role as UserRole)}</Badge></TableCell>
                          <TableCell><Badge variant={u.isActive ? 'default' : 'secondary'} className={u.isActive ? 'bg-emerald-600' : ''}>{u.isActive ? 'Active' : 'Inactive'}</Badge></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatDate(u.createdAt)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {u.id !== user?.id && (
                                <>
                                  <Button variant="outline" size="sm" onClick={() => handleOpenEditUser(u)}>
                                    Edit
                                  </Button>
                                  <Button variant="outline" size="sm" onClick={() => handleToggleUser(u.id, u.isActive)}>
                                    {u.isActive ? 'Deactivate' : 'Activate'}
                                  </Button>
                                </>
                              )}
                              {u.id === user?.id && (
                                <Badge variant="outline" className="text-xs text-muted-foreground">You</Badge>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== Staff Activity Tab (v4.66 — MAIN_ADMIN only) ==================== */}
        <TabsContent value="activity" className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" />Staff Activity Log</CardTitle>
              <CardDescription>Track all actions performed by staff members in this company</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Filters */}
              <div className="flex flex-wrap gap-2">
                <select
                  value={activityUser}
                  onChange={(e) => { setActivityUser(e.target.value); setActivityPage(1) }}
                  className="text-xs border rounded-md px-2 py-1.5 bg-background"
                >
                  <option value="all">All Staff</option>
                  {activityUsers.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                </select>
                <select
                  value={activityType}
                  onChange={(e) => { setActivityType(e.target.value); setActivityPage(1) }}
                  className="text-xs border rounded-md px-2 py-1.5 bg-background"
                >
                  <option value="all">All Actions</option>
                  <option value="CREATE">Create</option>
                  <option value="UPDATE">Update</option>
                  <option value="DELETE">Delete</option>
                  <option value="LOGIN">Login</option>
                  <option value="OTP">OTP</option>
                </select>
                <select
                  value={activityEntity}
                  onChange={(e) => { setActivityEntity(e.target.value); setActivityPage(1) }}
                  className="text-xs border rounded-md px-2 py-1.5 bg-background"
                >
                  <option value="all">All Types</option>
                  <option value="Sale">Sales</option>
                  <option value="Purchase">Purchases</option>
                  <option value="Expense">Expenses</option>
                  <option value="InventoryItem">Inventory</option>
                  <option value="Payment">Payments</option>
                  <option value="Receipt">Receipts</option>
                  <option value="Staff">Staff</option>
                  <option value="OTP">OTP</option>
                </select>
                <Button variant="outline" size="sm" onClick={() => { setActivityPage(1); loadActivity() }}>
                  <RefreshCw className="h-3 w-3 mr-1" />Refresh
                </Button>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-muted/50 p-2 rounded-lg text-center">
                  <p className="text-[10px] text-muted-foreground">Total Actions</p>
                  <p className="text-lg font-bold">{activityTotal}</p>
                </div>
                <div className="bg-muted/50 p-2 rounded-lg text-center">
                  <p className="text-[10px] text-muted-foreground">Staff Members</p>
                  <p className="text-lg font-bold">{activityUsers.length}</p>
                </div>
                <div className="bg-muted/50 p-2 rounded-lg text-center">
                  <p className="text-[10px] text-muted-foreground">Showing</p>
                  <p className="text-lg font-bold">{activityLogs.length}</p>
                </div>
              </div>

              {/* Activity Table */}
              {activityLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : activityLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No activity recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Date/Time</TableHead>
                        <TableHead className="text-xs">Staff</TableHead>
                        <TableHead className="text-xs">Action</TableHead>
                        <TableHead className="text-xs">Type</TableHead>
                        <TableHead className="text-xs">Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activityLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-xs whitespace-nowrap">{new Date(log.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</TableCell>
                          <TableCell className="text-xs">{log.userName || log.userId?.slice(0, 8) || 'System'}</TableCell>
                          <TableCell className="text-xs">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              log.action.includes('CREATE') ? 'bg-emerald-100 text-emerald-700' :
                              log.action.includes('UPDATE') ? 'bg-blue-100 text-blue-700' :
                              log.action.includes('DELETE') ? 'bg-rose-100 text-rose-700' :
                              log.action.includes('OTP') ? 'bg-amber-100 text-amber-700' :
                              'bg-slate-100 text-slate-600'
                            }`}>{log.action}</span>
                          </TableCell>
                          <TableCell className="text-xs">{log.entityType}</TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate" title={log.changes || ''}>{log.entityName || log.changes?.slice(0, 50) || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Pagination */}
              {activityTotal > activityPageSize && (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Page {activityPage} of {Math.ceil(activityTotal / activityPageSize)}</p>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" disabled={activityPage <= 1} onClick={() => { setActivityPage(p => p - 1); loadActivity() }}>Prev</Button>
                    <Button variant="outline" size="sm" disabled={activityPage >= Math.ceil(activityTotal / activityPageSize)} onClick={() => { setActivityPage(p => p + 1); loadActivity() }}>Next</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== Data Management Tab ==================== */}
        <TabsContent value="data" className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Database className="h-4 w-4" />Data Management</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-muted/50 p-4 rounded-lg">
                  <h4 className="font-medium text-sm mb-1 flex items-center gap-2"><Download className="h-4 w-4 text-emerald-600" /> Export Data</h4>
                  <p className="text-xs text-muted-foreground mb-3">Download a complete backup of your business data in JSON format.</p>
                  <Button size="sm" variant="outline" onClick={async () => {
                    if (!tenant) return
                    try {
                      const res = await authFetch('/api/backup', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'json', tenantId: tenant.id }),
                      })
                      if (res.ok) {
                        const data = await res.json()
                        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `${tenant.name.replace(/[^a-zA-Z0-9]/g, '_')}_backup_${new Date().toISOString().slice(0, 10)}.json`
                        a.click()
                        URL.revokeObjectURL(url)
                        toast({ title: 'Backup Downloaded' })
                      }
                    } catch {
                      toast({ title: 'Export Failed', variant: 'destructive' })
                    }
                  }}>
                    <Download className="h-3.5 w-3.5 mr-1" /> Download Backup
                  </Button>
                </div>
                <div className="bg-muted/50 p-4 rounded-lg">
                  <h4 className="font-medium text-sm mb-1 flex items-center gap-2"><Database className="h-4 w-4 text-blue-600" /> Database Stats</h4>
                  <p className="text-xs text-muted-foreground mb-3">View current database statistics and record counts.</p>
                  <Button size="sm" variant="outline" onClick={async () => {
                    try {
                      const res = await authFetch('/api/db-admin', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'stats' }),
                      })
                      if (res.ok) {
                        const data = await res.json()
                        setDbStats(data.stats || {})
                        toast({ title: 'Stats Loaded', description: `${Object.values(data.stats).reduce((a: number, b: unknown) => a + (b as number), 0)} total records` })
                      }
                    } catch {
                      toast({ title: 'Error', description: 'Failed to load stats', variant: 'destructive' })
                    }
                  }}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1" /> Load Stats
                  </Button>
                </div>
              </div>

              {Object.keys(dbStats).length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Object.entries(dbStats).map(([key, value]) => (
                    <div key={key} className="bg-muted/30 p-3 rounded text-center">
                      <p className="text-xs text-muted-foreground capitalize">{key}</p>
                      <p className="text-lg font-bold">{value as number}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== About Tab ==================== */}
        <TabsContent value="about" className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Info className="h-4 w-4" />About BizBook Pro</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="bg-muted/50 p-3 rounded-lg">
                    <p className="text-xs text-muted-foreground">Application</p>
                    <p className="font-semibold">BizBook Pro</p>
                    <p className="text-xs text-muted-foreground">Multi-tenant Billing, Inventory & Accounting SaaS</p>
                  </div>
                  <div className="bg-muted/50 p-3 rounded-lg">
                    <p className="text-xs text-muted-foreground">Version</p>
                    <p className="font-semibold">v4.66.0</p>
                    <p className="text-xs text-muted-foreground">Built with Next.js 16 + Prisma + PostgreSQL</p>
                    <p className="text-[10px] text-muted-foreground mt-1">A Product by Tahigo International</p>
                  </div>
                  <div className="bg-muted/50 p-3 rounded-lg">
                    <p className="text-xs text-muted-foreground">Company</p>
                    <p className="font-semibold">{tenant?.name || 'N/A'}</p>
                    <p className="text-xs text-muted-foreground">Plan: {tenant?.plan || 'Free'}</p>
                  </div>
                  <div className="bg-muted/50 p-3 rounded-lg">
                    <p className="text-xs text-muted-foreground">Created</p>
                    <p className="font-semibold">{tenantCreatedAt ? formatDate(tenantCreatedAt) : 'Loading...'}</p>
                    <p className="text-xs text-muted-foreground">Account creation date</p>
                  </div>
                  <div className="bg-muted/50 p-3 rounded-lg">
                    <p className="text-xs text-muted-foreground">Database</p>
                    <p className="font-semibold text-xs break-all">PostgreSQL</p>
                    <p className="text-xs text-muted-foreground">Storage engine</p>
                  </div>
                  <div className="bg-muted/50 p-3 rounded-lg">
                    <p className="text-xs text-muted-foreground">Current User</p>
                    <p className="font-semibold">{user?.name || 'N/A'}</p>
                    <p className="text-xs text-muted-foreground">{user ? getRoleLabel(user.role as UserRole) : ''}</p>
                  </div>
                </div>

                <div className="bg-emerald-50 dark:bg-emerald-950 p-4 rounded-lg mt-4">
                  <h4 className="font-medium text-sm text-emerald-700 dark:text-emerald-300 mb-2">Features</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                    <span>✓ Sale & Purchase Register</span>
                    <span>✓ Inventory Management</span>
                    <span>✓ Bank Statement</span>
                    <span>✓ P&L & Balance Sheet</span>
                    <span>✓ Day Report</span>
                    <span>✓ Staff & Salary</span>
                    <span>✓ GST Reports</span>
                    <span>✓ Batch & Expiry Tracking</span>
                    <span>✓ Price Lists</span>
                    <span>✓ Audit Log</span>
                    <span>✓ Multi-Company Support</span>
                    <span>✓ Data Backup & Restore</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ==================== Change Password Dialog ==================== */}
      <Dialog open={changeStep !== 'idle'} onOpenChange={(open) => { if (!open) closeChangeDialog() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-emerald-600" />
              Change Password
            </DialogTitle>
          </DialogHeader>

          {changeStep === 'form' && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="current-pass">Current Password</Label>
                <div className="relative">
                  <Input
                    id="current-pass"
                    type={showCurrentPass ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowCurrentPass(!showCurrentPass)}
                  >
                    {showCurrentPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label htmlFor="change-new-pass">New Password</Label>
                <div className="relative">
                  <Input
                    id="change-new-pass"
                    type={showNewPass ? 'text' : 'password'}
                    value={changeNewPassword}
                    onChange={(e) => setChangeNewPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    minLength={6}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowNewPass(!showNewPass)}
                  >
                    {showNewPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label htmlFor="change-confirm-pass">Confirm New Password</Label>
                <Input
                  id="change-confirm-pass"
                  type="password"
                  value={changeConfirmPassword}
                  onChange={(e) => setChangeConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  minLength={6}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleChangePassword() }}
                />
              </div>
              {changeError && <p className="text-sm text-destructive">{changeError}</p>}
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={closeChangeDialog}>Cancel</Button>
                <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleChangePassword} disabled={changeLoading}>
                  {changeLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Changing...</> : 'Change Password'}
                </Button>
              </DialogFooter>
            </div>
          )}

          {changeStep === 'done' && (
            <div className="space-y-4 text-center py-4">
              <div className="mx-auto h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center">
                <KeyRound className="h-8 w-8 text-emerald-600" />
              </div>
              <h3 className="text-lg font-semibold">Password Changed Successfully</h3>
              <p className="text-sm text-muted-foreground">
                Your password has been updated. Use the new password next time you login.
              </p>
              <Button className="bg-emerald-600 hover:bg-emerald-700 w-full" onClick={closeChangeDialog}>
                Done
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ==================== Reset Password Dialog (OTP Flow) ==================== */}
      <Dialog open={resetStep !== 'idle'} onOpenChange={(open) => { if (!open) closeResetDialog() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-emerald-600" />
              Reset Password
            </DialogTitle>
          </DialogHeader>

          {resetStep === 'request' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Enter the email address or phone number associated with your account. We will send you a one-time password (OTP) to verify your identity.
              </p>
              <div>
                <Label htmlFor="settings-reset-identifier">Email or Phone Number</Label>
                <Input
                  id="settings-reset-identifier"
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
              {otpDeliveryMethod === 'both' ? (
                <div className="bg-emerald-50 dark:bg-emerald-950 p-3 rounded-lg text-sm">
                  <p className="font-medium text-emerald-700 dark:text-emerald-300">OTP sent to email & mobile</p>
                  {resetEmail && (
                    <p className="text-emerald-600 dark:text-emerald-400 text-xs mt-1">
                      Email: {resetEmail.replace(/(.{2})(.*)(@.*)/, '$1***$3')}
                    </p>
                  )}
                </div>
              ) : otpDeliveryMethod === 'email' ? (
                <div className="bg-emerald-50 dark:bg-emerald-950 p-3 rounded-lg text-sm">
                  <p className="font-medium text-emerald-700 dark:text-emerald-300">OTP sent to your email</p>
                  {resetEmail && (
                    <p className="text-emerald-600 dark:text-emerald-400 text-xs mt-1">
                      {resetEmail.replace(/(.{2})(.*)(@.*)/, '$1***$3')}
                    </p>
                  )}
                </div>
              ) : otpDeliveryMethod === 'sms' ? (
                <div className="bg-emerald-50 dark:bg-emerald-950 p-3 rounded-lg text-sm">
                  <p className="font-medium text-emerald-700 dark:text-emerald-300">OTP sent via SMS</p>
                </div>
              ) : otpDeliveryMethod === 'failed' ? (
                <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-3 rounded-lg text-sm">
                  <p className="font-medium text-red-700 dark:text-red-300">OTP delivery failed</p>
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
                <Label htmlFor="settings-reset-otp">Enter OTP</Label>
                <Input
                  id="settings-reset-otp"
                  value={resetOtp}
                  onChange={(e) => setResetOtp(e.target.value)}
                  placeholder="6-digit OTP"
                  maxLength={6}
                  className="text-center text-lg tracking-widest font-mono"
                />
              </div>
              <div>
                <Label htmlFor="settings-reset-new-pass">New Password</Label>
                <Input
                  id="settings-reset-new-pass"
                  type="password"
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  minLength={6}
                />
              </div>
              <div>
                <Label htmlFor="settings-reset-confirm-pass">Confirm New Password</Label>
                <Input
                  id="settings-reset-confirm-pass"
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

          {resetStep === 'done' && (
            <div className="space-y-4 text-center py-4">
              <div className="mx-auto h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center">
                <KeyRound className="h-8 w-8 text-emerald-600" />
              </div>
              <h3 className="text-lg font-semibold">Password Reset Successfully</h3>
              <p className="text-sm text-muted-foreground">
                Your password has been changed. Use the new password next time you login.
              </p>
              <Button className="bg-emerald-600 hover:bg-emerald-700 w-full" onClick={closeResetDialog}>
                Done
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add User Dialog */}
      <Dialog open={showAddUser} onOpenChange={setShowAddUser}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add New User</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} /></div>
            <div><Label>Email</Label><Input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} /></div>
            <div><Label>Password</Label><Input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} /></div>
            <div><Label>Role</Label><Select value={newUser.role} onValueChange={(v) => setNewUser({ ...newUser, role: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="VIEW_ONLY">View Only</SelectItem><SelectItem value="DATA_ENTRY">Data Entry</SelectItem><SelectItem value="JUNIOR_ADMIN">Junior Admin</SelectItem></SelectContent></Select></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowAddUser(false)}>Cancel</Button><Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleAddUser}>Add User</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Role Dialog */}
      <Dialog open={showEditUser} onOpenChange={(open) => { setShowEditUser(open); if (!open) setEditUserTarget(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit User Role</DialogTitle></DialogHeader>
          {editUserTarget && (
            <div className="space-y-3">
              <div className="bg-muted/50 p-3 rounded-lg">
                <p className="text-sm font-medium">{editUserTarget.name}</p>
                <p className="text-xs text-muted-foreground">{editUserTarget.email}</p>
                <p className="text-xs text-muted-foreground mt-1">Current role: {getRoleLabel(editUserTarget.role as UserRole)}</p>
              </div>
              <div>
                <Label>New Role</Label>
                <Select value={editUserRole} onValueChange={setEditUserRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="VIEW_ONLY">View Only — can view reports only</SelectItem>
                    <SelectItem value="DATA_ENTRY">Data Entry — can create new records</SelectItem>
                    <SelectItem value="JUNIOR_ADMIN">Junior Admin — can edit/delete records</SelectItem>
                    <SelectItem value="MAIN_ADMIN">Main Admin — full control</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="text-xs text-muted-foreground bg-amber-50 dark:bg-amber-950/30 p-2 rounded border border-amber-200 dark:border-amber-900">
                <strong>Note:</strong> Changing a user's role affects what they can do across all modules.
                {editUserTarget.role === 'MAIN_ADMIN' && ' Demoting a Main Admin will remove their access to Settings.'}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowEditUser(false); setEditUserTarget(null) }}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleEditUser} disabled={editUserLoading}>
              {editUserLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Business Dialog */}
      <Dialog open={showEditBiz} onOpenChange={setShowEditBiz}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Business Details</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Business Name</Label><Input value={bizForm.name} onChange={(e) => setBizForm({ ...bizForm, name: e.target.value })} /></div>
            <div><Label>Address</Label><Input value={bizForm.address} onChange={(e) => setBizForm({ ...bizForm, address: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Phone</Label><Input value={bizForm.phone} onChange={(e) => setBizForm({ ...bizForm, phone: e.target.value })} /></div>
              <div><Label>Email</Label><Input value={bizForm.email} onChange={(e) => setBizForm({ ...bizForm, email: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>GST Number</Label><Input value={bizForm.gstNumber} onChange={(e) => setBizForm({ ...bizForm, gstNumber: e.target.value })} /></div>
              <div><Label>PAN Number</Label><Input value={bizForm.panNumber} onChange={(e) => setBizForm({ ...bizForm, panNumber: e.target.value })} /></div>
              <div><Label>UPI ID (for invoice QR)</Label><Input value={bizForm.upiId} onChange={(e) => setBizForm({ ...bizForm, upiId: e.target.value })} placeholder="e.g. business@okhdfcbank" /></div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowEditBiz(false)}>Cancel</Button><Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleUpdateBiz}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
