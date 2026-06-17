'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useAppStore, canEdit, canCorrect } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatCurrency, formatDate } from '@/lib/formulas'
import { Fingerprint, Clock, CalendarDays, Users, CheckCircle, XCircle, Loader2, Save, Volume2, UserCheck } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { triggerBackupDownload } from '@/hooks/use-excel-backup'
import { authFetch } from '@/lib/auth-fetch'

interface StaffMember {
  id: string; name: string; department: string | null; isActive: boolean; fingerprintId?: string | null
}

interface AttendanceRecord {
  id: string
  staffId: string
  date: string
  checkIn: string | null
  checkOut: string | null
  status: string
  checkInMethod: string
  checkOutMethod: string
  workingHours: number
  notes: string | null
  staff: { name: string; department: string | null }
}

interface MonthlySummaryItem {
  staffId: string; staffName: string; department: string | null
  present: number; absent: number; halfDay: number; leave: number; holiday: number
  totalWorkingHours: number
}

type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LEAVE' | 'HOLIDAY'
type CheckMethod = 'MANUAL' | 'BIOMETRIC' | 'FINGERPRINT'

const statusColors: Record<string, string> = {
  PRESENT: 'bg-emerald-100 text-emerald-700',
  ABSENT: 'bg-red-100 text-red-700',
  HALF_DAY: 'bg-amber-100 text-amber-700',
  LEAVE: 'bg-blue-100 text-blue-700',
  HOLIDAY: 'bg-purple-100 text-purple-700',
}

const methodColors: Record<string, string> = {
  MANUAL: 'bg-gray-100 text-gray-600',
  BIOMETRIC: 'bg-cyan-100 text-cyan-700',
  FINGERPRINT: 'bg-indigo-100 text-indigo-700',
}

export function AttendanceRegister() {
  const { tenant, user } = useAppStore()
  const { toast } = useToast()

  // View state
  const [activeTab, setActiveTab] = useState('daily')
  const [loading, setLoading] = useState(true)

  // Daily view state
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [records, setRecords] = useState<AttendanceRecord[]>([])

  // Monthly summary state
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7))
  const [summary, setSummary] = useState<MonthlySummaryItem[]>([])

  // Fingerprint scanner mode
  const [fingerprintMode, setFingerprintMode] = useState(false)
  const [fingerprintInput, setFingerprintInput] = useState('')
  const [fingerprintStatus, setFingerprintStatus] = useState<'idle' | 'scanning' | 'matched' | 'unmatched'>('idle')
  const fingerprintInputRef = useRef<HTMLInputElement>(null)
  const fingerprintBufferRef = useRef<string>('')
  const fingerprintTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Edit state for individual record
  const [editingRecord, setEditingRecord] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{ status: string; checkIn: string; checkOut: string; notes: string }>({
    status: 'PRESENT', checkIn: '', checkOut: '', notes: '',
  })

  const fetchStaff = useCallback(async () => {
    if (!tenant) return
    const res = await authFetch('/api/staff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', tenantId: tenant.id, activeOnly: true }),
    })
    const data = await res.json()
    setStaffList((data.staff || []).map((s: StaffMember) => ({ id: s.id, name: s.name, department: s.department, isActive: s.isActive, fingerprintId: s.fingerprintId })))
  }, [tenant])

  const fetchRecords = useCallback(async () => {
    if (!tenant) return
    setLoading(true)
    try {
      const res = await authFetch('/api/attendance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', tenantId: tenant.id, date: selectedDate }),
      })
      const data = await res.json()
      setRecords(data.records || [])
    } catch {
      toast({ title: 'Error', description: 'Failed to load attendance', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [tenant, selectedDate, toast])

  const fetchSummary = useCallback(async () => {
    if (!tenant) return
    try {
      const res = await authFetch('/api/attendance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'monthly-summary', tenantId: tenant.id, month: selectedMonth }),
      })
      const data = await res.json()
      setSummary(data.summary || [])
    } catch {
      toast({ title: 'Error', description: 'Failed to load summary', variant: 'destructive' })
    }
  }, [tenant, selectedMonth, toast])

  useEffect(() => { fetchStaff() }, [fetchStaff])
  useEffect(() => { if (activeTab === 'daily') fetchRecords() }, [fetchRecords, activeTab])
  useEffect(() => { if (activeTab === 'monthly') fetchSummary() }, [fetchSummary, activeTab])

  // Fingerprint scanner: listen for rapid keyboard input
  useEffect(() => {
    if (!fingerprintMode) return
    // Focus the hidden input when fingerprint mode is on
    setTimeout(() => fingerprintInputRef.current?.focus(), 100)

    const handleKeydown = (e: KeyboardEvent) => {
      if (!fingerprintMode) return
      // Ignore if typing in a regular input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        if (e.target !== fingerprintInputRef.current) return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        processFingerprintScan(fingerprintBufferRef.current)
        fingerprintBufferRef.current = ''
        return
      }
      // Accumulate keystrokes
      if (e.key.length === 1) {
        fingerprintBufferRef.current += e.key
        // Reset timer
        if (fingerprintTimerRef.current) clearTimeout(fingerprintTimerRef.current)
        fingerprintTimerRef.current = setTimeout(() => {
          // If no more keystrokes for 200ms, process the scan
          if (fingerprintBufferRef.current.length > 0) {
            processFingerprintScan(fingerprintBufferRef.current)
            fingerprintBufferRef.current = ''
          }
        }, 200)
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [fingerprintMode, staffList]) // eslint-disable-line react-hooks/exhaustive-deps

  // Play a beep sound for scan feedback
  const playBeep = (success: boolean) => {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      const oscillator = ctx.createOscillator()
      const gainNode = ctx.createGain()
      oscillator.connect(gainNode)
      gainNode.connect(ctx.destination)
      if (success) {
        // Success: two short beeps
        oscillator.frequency.value = 880
        gainNode.gain.value = 0.3
        oscillator.start(ctx.currentTime)
        oscillator.stop(ctx.currentTime + 0.1)
        setTimeout(() => {
          const osc2 = ctx.createOscillator()
          const gain2 = ctx.createGain()
          osc2.connect(gain2)
          gain2.connect(ctx.destination)
          osc2.frequency.value = 1100
          gain2.gain.value = 0.3
          osc2.start(ctx.currentTime)
          osc2.stop(ctx.currentTime + 0.15)
        }, 150)
      } else {
        // Failure: one low buzz
        oscillator.frequency.value = 300
        gainNode.gain.value = 0.3
        oscillator.start(ctx.currentTime)
        oscillator.stop(ctx.currentTime + 0.3)
      }
    } catch {
      // Audio not available
    }
  }

  const processFingerprintScan = async (scanId: string) => {
    if (!tenant || !scanId.trim()) return
    setFingerprintInput(`Scanned: ${scanId}`)
    setFingerprintStatus('scanning')

    // Try to match the scan ID with a staff member
    // Priority: fingerprintId > staff ID > name match
    const matchedStaff = staffList.find(
      (s) => s.fingerprintId === scanId || s.id === scanId || s.name.toLowerCase().includes(scanId.toLowerCase())
    )

    if (!matchedStaff) {
      setFingerprintStatus('unmatched')
      playBeep(false)
      toast({ title: 'No Match', description: `No staff member found for scan: ${scanId}`, variant: 'destructive' })
      setTimeout(() => { setFingerprintInput(''); setFingerprintStatus('idle') }, 3000)
      return
    }

    setFingerprintStatus('matched')
    playBeep(true)

    // Check if the staff has checked in today
    const todayRecord = records.find((r) => r.staffId === matchedStaff.id)

    if (!todayRecord || !todayRecord.checkIn) {
      // Check in
      const res = await authFetch('/api/attendance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'check-in', tenantId: tenant.id, staffId: matchedStaff.id,
          date: selectedDate, method: 'FINGERPRINT',
        }),
      })
      if (res.ok) {
        toast({ title: 'Checked In', description: `${matchedStaff.name} checked in via fingerprint` })
        triggerBackupDownload(tenant?.id, tenant?.name, 'attendance:check-in')
        setTimeout(() => { setFingerprintInput(''); setFingerprintStatus('idle') }, 2000)
        fetchRecords()
      }
    } else if (!todayRecord.checkOut) {
      // Check out
      const res = await authFetch('/api/attendance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'check-out', tenantId: tenant.id, staffId: matchedStaff.id,
          date: selectedDate, method: 'FINGERPRINT',
        }),
      })
      if (res.ok) {
        toast({ title: 'Checked Out', description: `${matchedStaff.name} checked out via fingerprint` })
        triggerBackupDownload(tenant?.id, tenant?.name, 'attendance:check-out')
        setTimeout(() => { setFingerprintInput(''); setFingerprintStatus('idle') }, 2000)
        fetchRecords()
      }
    } else {
      toast({ title: 'Already Completed', description: `${matchedStaff.name} already checked in and out today` })
      setTimeout(() => { setFingerprintInput(''); setFingerprintStatus('idle') }, 2000)
    }
  }

  const handleCheckIn = async (staffId: string) => {
    if (!tenant) return
    const res = await authFetch('/api/attendance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check-in', tenantId: tenant.id, staffId, date: selectedDate, method: 'MANUAL' }),
    })
    if (res.ok) { toast({ title: 'Checked In' }); triggerBackupDownload(tenant?.id, tenant?.name, 'attendance:check-in'); fetchRecords() }
    else toast({ title: 'Error', variant: 'destructive' })
  }

  const handleCheckOut = async (staffId: string) => {
    if (!tenant) return
    const res = await authFetch('/api/attendance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check-out', tenantId: tenant.id, staffId, date: selectedDate, method: 'MANUAL' }),
    })
    if (res.ok) { toast({ title: 'Checked Out' }); triggerBackupDownload(tenant?.id, tenant?.name, 'attendance:check-out'); fetchRecords() }
    else toast({ title: 'Error', variant: 'destructive' })
  }

  const handleUpdateRecord = async (recordId: string) => {
    if (!tenant) return
    const data: Record<string, unknown> = {
      status: editForm.status,
      notes: editForm.notes || null,
    }
    if (editForm.checkIn) data.checkIn = new Date(editForm.checkIn).toISOString()
    if (editForm.checkOut) data.checkOut = new Date(editForm.checkOut).toISOString()

    const res = await authFetch('/api/attendance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', tenantId: tenant.id, id: recordId, data }),
    })
    if (res.ok) { toast({ title: 'Updated' }); triggerBackupDownload(tenant?.id, tenant?.name, 'attendance:update'); setEditingRecord(null); fetchRecords() }
    else toast({ title: 'Error', variant: 'destructive' })
  }

  const startEdit = (record: AttendanceRecord) => {
    setEditingRecord(record.id)
    setEditForm({
      status: record.status,
      checkIn: record.checkIn ? new Date(record.checkIn).toISOString().slice(0, 16) : '',
      checkOut: record.checkOut ? new Date(record.checkOut).toISOString().slice(0, 16) : '',
      notes: record.notes || '',
    })
  }

  const formatTime = (isoString: string | null) => {
    if (!isoString) return '-'
    const d = new Date(isoString)
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  }

  // Build display rows: merge staff list with existing attendance records
  const displayRows = staffList.map((staff) => {
    const record = records.find((r) => r.staffId === staff.id)
    return { staff, record: record || null }
  })

  const todayStats = {
    present: records.filter((r) => r.status === 'PRESENT').length,
    absent: staffList.length - records.length + records.filter((r) => r.status === 'ABSENT').length,
    halfDay: records.filter((r) => r.status === 'HALF_DAY').length,
    leave: records.filter((r) => r.status === 'LEAVE').length,
  }

  return (
    <div>
      <AppHeader title="Attendance Register" />
      <div className="p-4 sm:p-6 pb-8 space-y-4">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle className="h-7 w-7 text-emerald-600" />
              <div><p className="text-xs text-muted-foreground">Present</p><p className="text-lg font-bold text-emerald-600">{todayStats.present}</p></div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <XCircle className="h-7 w-7 text-red-600" />
              <div><p className="text-xs text-muted-foreground">Absent</p><p className="text-lg font-bold text-red-600">{todayStats.absent}</p></div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <Clock className="h-7 w-7 text-amber-600" />
              <div><p className="text-xs text-muted-foreground">Half Day</p><p className="text-lg font-bold text-amber-600">{todayStats.halfDay}</p></div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <CalendarDays className="h-7 w-7 text-blue-600" />
              <div><p className="text-xs text-muted-foreground">On Leave</p><p className="text-lg font-bold text-blue-600">{todayStats.leave}</p></div>
            </CardContent>
          </Card>
        </div>

        {/* Fingerprint Scanner Mode Toggle */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant={fingerprintMode ? 'default' : 'outline'}
            className={fingerprintMode ? 'bg-indigo-600 hover:bg-indigo-700' : ''}
            onClick={() => setFingerprintMode(!fingerprintMode)}
          >
            <Fingerprint className="h-4 w-4 mr-2" />
            {fingerprintMode ? 'Fingerprint Scanner Active' : 'Enable Fingerprint Scanner'}
          </Button>
          {fingerprintMode && (
            <>
              <input
                ref={fingerprintInputRef}
                className="opacity-0 absolute w-0 h-0"
                value={fingerprintInput}
                onChange={() => {}}
                autoFocus
              />
              {/* Status indicator */}
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
                fingerprintStatus === 'matched' ? 'bg-emerald-100 text-emerald-700' :
                fingerprintStatus === 'unmatched' ? 'bg-red-100 text-red-700' :
                fingerprintStatus === 'scanning' ? 'bg-amber-100 text-amber-700 animate-pulse' :
                'bg-indigo-100 text-indigo-700'
              }`}>
                {fingerprintStatus === 'matched' && <UserCheck className="h-4 w-4" />}
                {fingerprintStatus === 'unmatched' && <XCircle className="h-4 w-4" />}
                {fingerprintStatus === 'scanning' && <Loader2 className="h-4 w-4 animate-spin" />}
                {fingerprintStatus === 'idle' && <Fingerprint className="h-4 w-4" />}
                {fingerprintInput || 'Waiting for scan...'}
              </div>
              <Volume2 className="h-4 w-4 text-muted-foreground" title="Audio feedback enabled" />
              <p className="text-xs text-muted-foreground">Scan a fingerprint or type staff ID/Fingerprint ID to auto check-in/out</p>
              <div className="text-xs text-muted-foreground">
                {staffList.filter(s => s.fingerprintId).length}/{staffList.length} staff enrolled
              </div>
            </>
          )}
        </div>

        {/* Tabs: Daily / Monthly Summary */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="daily">Daily Attendance</TabsTrigger>
            <TabsTrigger value="monthly">Monthly Summary</TabsTrigger>
          </TabsList>

          {/* ==================== DAILY VIEW ==================== */}
          <TabsContent value="daily" className="space-y-4">
            <div className="flex items-center gap-3">
              <Label className="text-sm font-medium">Date:</Label>
              <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="w-44" />
              <Button variant="outline" size="sm" onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}>Today</Button>
            </div>

            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>
            ) : (
              <Card className="border-0 shadow-sm">
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Staff Name</TableHead>
                          <TableHead>Department</TableHead>
                          <TableHead>Check In</TableHead>
                          <TableHead>Check Out</TableHead>
                          <TableHead>Hours</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Method</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {displayRows.length === 0 ? (
                          <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No staff members found</TableCell></TableRow>
                        ) : displayRows.map(({ staff, record }) => (
                          <TableRow key={staff.id}>
                            <TableCell className="font-medium">{staff.name}</TableCell>
                            <TableCell>{staff.department || '-'}</TableCell>
                            <TableCell>
                              {editingRecord === record?.id ? (
                                <Input type="datetime-local" value={editForm.checkIn} onChange={(e) => setEditForm({ ...editForm, checkIn: e.target.value })} className="h-8 text-xs" />
                              ) : (
                                formatTime(record?.checkIn || null)
                              )}
                            </TableCell>
                            <TableCell>
                              {editingRecord === record?.id ? (
                                <Input type="datetime-local" value={editForm.checkOut} onChange={(e) => setEditForm({ ...editForm, checkOut: e.target.value })} className="h-8 text-xs" />
                              ) : (
                                formatTime(record?.checkOut || null)
                              )}
                            </TableCell>
                            <TableCell>
                              {record?.workingHours ? `${record.workingHours}h` : '-'}
                            </TableCell>
                            <TableCell>
                              {editingRecord === record?.id ? (
                                <Select value={editForm.status} onValueChange={(val) => setEditForm({ ...editForm, status: val })}>
                                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="PRESENT">Present</SelectItem>
                                    <SelectItem value="ABSENT">Absent</SelectItem>
                                    <SelectItem value="HALF_DAY">Half Day</SelectItem>
                                    <SelectItem value="LEAVE">Leave</SelectItem>
                                    <SelectItem value="HOLIDAY">Holiday</SelectItem>
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Badge variant="secondary" className={`text-xs ${statusColors[record?.status || 'ABSENT'] || ''}`}>
                                  {record?.status || 'NOT_RECORDED'}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {record && (
                                <Badge variant="outline" className={`text-xs ${methodColors[record.checkInMethod] || ''}`}>
                                  {record.checkInMethod}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                {!record && canEdit(user?.role || 'VIEW_ONLY') && (
                                  <Button variant="ghost" size="sm" className="h-7 text-xs text-emerald-600" onClick={() => handleCheckIn(staff.id)}>
                                    <CheckCircle className="h-3.5 w-3.5 mr-1" />Check In
                                  </Button>
                                )}
                                {record?.checkIn && !record?.checkOut && canEdit(user?.role || 'VIEW_ONLY') && (
                                  <Button variant="ghost" size="sm" className="h-7 text-xs text-amber-600" onClick={() => handleCheckOut(staff.id)}>
                                    <Clock className="h-3.5 w-3.5 mr-1" />Check Out
                                  </Button>
                                )}
                                {record && editingRecord === record.id && canCorrect(user?.role || 'VIEW_ONLY') && (
                                  <Button variant="ghost" size="sm" className="h-7 text-xs text-emerald-600" onClick={() => handleUpdateRecord(record.id)}>
                                    <Save className="h-3.5 w-3.5 mr-1" />Save
                                  </Button>
                                )}
                                {record && editingRecord !== record.id && canCorrect(user?.role || 'VIEW_ONLY') && (
                                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => startEdit(record)}>
                                    Edit
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ==================== MONTHLY SUMMARY VIEW ==================== */}
          <TabsContent value="monthly" className="space-y-4">
            <div className="flex items-center gap-3">
              <Label className="text-sm font-medium">Month:</Label>
              <Input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="w-44" />
            </div>

            <Card className="border-0 shadow-sm">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Staff Name</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead className="text-center">Present</TableHead>
                        <TableHead className="text-center">Absent</TableHead>
                        <TableHead className="text-center">Half Day</TableHead>
                        <TableHead className="text-center">Leave</TableHead>
                        <TableHead className="text-center">Holiday</TableHead>
                        <TableHead className="text-right">Total Hours</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.length === 0 ? (
                        <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No attendance data for this month</TableCell></TableRow>
                      ) : summary.map((item) => (
                        <TableRow key={item.staffId}>
                          <TableCell className="font-medium">{item.staffName}</TableCell>
                          <TableCell>{item.department || '-'}</TableCell>
                          <TableCell className="text-center"><Badge variant="secondary" className="bg-emerald-100 text-emerald-700 text-xs">{item.present}</Badge></TableCell>
                          <TableCell className="text-center"><Badge variant="secondary" className="bg-red-100 text-red-700 text-xs">{item.absent}</Badge></TableCell>
                          <TableCell className="text-center"><Badge variant="secondary" className="bg-amber-100 text-amber-700 text-xs">{item.halfDay}</Badge></TableCell>
                          <TableCell className="text-center"><Badge variant="secondary" className="bg-blue-100 text-blue-700 text-xs">{item.leave}</Badge></TableCell>
                          <TableCell className="text-center"><Badge variant="secondary" className="bg-purple-100 text-purple-700 text-xs">{item.holiday}</Badge></TableCell>
                          <TableCell className="text-right font-semibold">{item.totalWorkingHours}h</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
