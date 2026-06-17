'use client'

import { useAppStore, type CompanyInfo } from '@/store/app-store'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Building2, Plus, ChevronRight, Loader2, Check, ArrowLeft, FileSpreadsheet } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useState, useEffect } from 'react'
import { useToast } from '@/hooks/use-toast'
import { BackupImportDialog } from '@/components/modules/backup-import-dialog'
import { authFetch } from '@/lib/auth-fetch'

export function CompanySelectPage() {
  const { user, companies, tenant, switchCompany, setView } = useAppStore()
  const { toast } = useToast()
  const [showAddCompany, setShowAddCompany] = useState(false)
  const [loading, setLoading] = useState(false)
  const [bizName, setBizName] = useState('')
  const [bizAddress, setBizAddress] = useState('')
  const [bizPhone, setBizPhone] = useState('')
  const [bizGst, setBizGst] = useState('')
  const [showBackupImport, setShowBackupImport] = useState(false)
  const [backupCompanyName, setBackupCompanyName] = useState('')

  const handleSelectCompany = async (company: CompanyInfo) => {
    try {
      const res = await authFetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'switch-company', userId: user?.id, tenantId: company.tenantId }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: 'Error', description: data.error, variant: 'destructive' })
        return
      }
      switchCompany(data.tenant)
      toast({ title: 'Company Switched', description: `Now working with ${company.name}` })

      // Auto-open backup import dialog with storage access popup after switching company
      setBackupCompanyName(company.name)
      setShowBackupImport(true)
    } catch {
      toast({ title: 'Error', description: 'Failed to switch company', variant: 'destructive' })
    }
  }

  const handleAddCompany = async () => {
    if (!bizName.trim()) {
      toast({ title: 'Error', description: 'Business name is required', variant: 'destructive' })
      return
    }
    setLoading(true)
    try {
      const res = await authFetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add-company',
          userId: user?.id,
          businessName: bizName.trim(),
          businessAddress: bizAddress.trim(),
          businessPhone: bizPhone.trim(),
          businessGst: bizGst.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: 'Error', description: data.error, variant: 'destructive' })
        return
      }

      // Switch to the newly created company
      switchCompany(data.tenant)
      // Update the companies list in store
      useAppStore.getState().setCompanies(data.companies || [])

      setShowAddCompany(false)
      setBizName(''); setBizAddress(''); setBizPhone(''); setBizGst('')
      toast({ title: 'Company Added!', description: `${data.tenant.name} has been created and selected.` })
    } catch {
      toast({ title: 'Error', description: 'Failed to add company', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  // Listen for close event from BackupImportDialog
  useEffect(() => {
    const handleClose = () => setShowBackupImport(false)
    window.addEventListener('close-backup-import', handleClose)
    return () => window.removeEventListener('close-backup-import', handleClose)
  }, [])

  const isCurrentCompany = (companyTenantId: string) => tenant?.id === companyTenantId

  return (
    <div className="app-fullpage bg-gradient-to-br from-emerald-50 via-white to-teal-50 dark:from-gray-950 dark:via-gray-900 dark:to-emerald-950 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <img src="/logo.png" alt="BizBook Pro" className="h-16 w-16 rounded-xl shadow-lg object-contain" />
          </div>
          <h1 className="text-2xl font-bold">Your Companies</h1>
          <p className="text-muted-foreground text-sm mt-1">Welcome back, {user?.name}! Select a company or add a new one.</p>
        </div>

        <div className="space-y-3">
          {companies.map((company) => (
            <Card
              key={company.tenantId}
              className={`cursor-pointer hover:border-emerald-400 hover:shadow-md transition-all border ${
                isCurrentCompany(company.tenantId)
                  ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
              onClick={() => handleSelectCompany(company)}
            >
              <CardContent className="p-4 flex items-center gap-4">
                <div className="h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center flex-shrink-0">
                  <Building2 className="h-5 w-5 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm truncate">{company.name}</h3>
                  <p className="text-xs text-muted-foreground truncate">
                    {company.tenant.phone && `${company.tenant.phone} · `}
                    {company.tenant.gstNumber && `GST: ${company.tenant.gstNumber} · `}
                    {company.isOwner ? 'Owner' : company.role}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {!isCurrentCompany(company.tenantId) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                      onClick={(e) => {
                        e.stopPropagation()
                        setBackupCompanyName(company.name)
                        // First switch to the company, then show backup import
                        handleSelectCompany(company)
                      }}
                      title="Import Backup for this company"
                    >
                      <FileSpreadsheet className="h-4 w-4" />
                    </Button>
                  )}
                  {isCurrentCompany(company.tenantId) ? (
                    <div className="flex items-center gap-1 text-emerald-600">
                      <Check className="h-4 w-4" />
                      <span className="text-xs font-medium">Active</span>
                    </div>
                  ) : (
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
              </CardContent>
            </Card>
          ))}

          {/* Add New Company Button */}
          <Card
            className="cursor-pointer border-dashed border-2 border-emerald-300 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950 transition-all"
            onClick={() => setShowAddCompany(true)}
          >
            <CardContent className="p-4 flex items-center justify-center gap-2 text-emerald-600">
              <Plus className="h-5 w-5" />
              <span className="font-medium text-sm">Add New Company</span>
            </CardContent>
          </Card>
        </div>

        {/* Back to Dashboard button — shown when navigating from sidebar */}
        {tenant && (
          <div className="mt-6 text-center">
            <Button
              variant="outline"
              onClick={() => setView('dashboard')}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </Button>
          </div>
        )}
      </div>

      {/* Backup Import Dialog */}
      <BackupImportDialog
        open={showBackupImport}
        companyName={backupCompanyName}
      />

      {/* Add Company Dialog */}
      <Dialog open={showAddCompany} onOpenChange={setShowAddCompany}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-emerald-600" />
              Add New Company
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Company Name <span className="text-red-500">*</span></Label>
              <Input value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder="e.g. My New Business" />
            </div>
            <div>
              <Label>Address</Label>
              <Input value={bizAddress} onChange={(e) => setBizAddress(e.target.value)} placeholder="Business address" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Phone</Label>
                <Input value={bizPhone} onChange={(e) => setBizPhone(e.target.value)} placeholder="Phone number" />
              </div>
              <div>
                <Label>GST Number</Label>
                <Input value={bizGst} onChange={(e) => setBizGst(e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              This company will be added to your account. You can switch between companies anytime from the sidebar.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddCompany(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleAddCompany} disabled={loading}>
              {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating...</> : 'Create Company'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
