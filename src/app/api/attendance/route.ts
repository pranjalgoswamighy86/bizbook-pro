import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { triggerAutoBackup } from '@/lib/auto-backup'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant ID is required' }, { status: 400 })
    }

    // Check-in: record a staff member's check-in time
    if (action === 'check-in') {
      const { staffId, date, checkInTime, method } = body
      const checkIn = new Date(checkInTime || new Date())
      const attendanceDate = new Date(date || new Date())

      // v4.149: Lookup staff name for denormalized field
      const staff = await db.staff.findUnique({ where: { id: staffId }, select: { name: true } })
      if (!staff) {
        return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
      }

      // Check if attendance record already exists for this staff+date
      const existing = await db.staffAttendance.findFirst({
        where: { staffId, date: attendanceDate, isDeleted: false },
      })

      if (existing) {
        // Update check-in time if not already set
        if (!existing.checkIn) {
          const updated = await db.staffAttendance.update({
            where: { id: existing.id },
            data: { checkIn, checkInMethod: method || 'MANUAL', status: 'PRESENT' },
          })
          triggerAutoBackup(tenantId, 'attendance:check-in')
          return NextResponse.json({ attendance: updated })
        }
        return NextResponse.json({ attendance: existing, message: 'Already checked in' })
      }

      const attendance = await db.staffAttendance.create({
        data: {
          staffId,
          staffName: staff.name,
          date: attendanceDate,
          checkIn,
          checkInMethod: method || 'MANUAL',
          status: 'PRESENT',
          tenantId,
        },
      })
      triggerAutoBackup(tenantId, 'attendance:check-in')
      return NextResponse.json({ attendance })
    }

    // Check-out: record a staff member's check-out time
    if (action === 'check-out') {
      const { staffId, date, checkOutTime, method } = body
      const checkOut = new Date(checkOutTime || new Date())
      const attendanceDate = new Date(date || new Date())

      const existing = await db.staffAttendance.findFirst({
        where: { staffId, date: attendanceDate, isDeleted: false },
      })

      if (!existing) {
        return NextResponse.json({ error: 'No check-in record found' }, { status: 404 })
      }

      // Calculate working hours
      let workingHours = existing.workingHours || 0
      if (existing.checkIn) {
        const diffMs = checkOut.getTime() - new Date(existing.checkIn).getTime()
        workingHours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100
      }

      const updated = await db.staffAttendance.update({
        where: { id: existing.id },
        data: {
          checkOut,
          checkOutMethod: method || 'MANUAL',
          workingHours: Math.max(0, workingHours),
        },
      })
      triggerAutoBackup(tenantId, 'attendance:check-out')
      return NextResponse.json({ attendance: updated })
    }

    // List attendance records for a date
    if (action === 'list') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { date, staffId, month } = body
      const where: Record<string, unknown> = { tenantId, isDeleted: false }

      if (date) {
        const start = new Date(date)
        start.setHours(0, 0, 0, 0)
        const end = new Date(date)
        end.setHours(23, 59, 59, 999)
        where.date = { gte: start, lte: end }
      } else if (month) {
        // month format: "2025-03"
        const [year, mon] = month.split('-').map(Number)
        const start = new Date(year, mon - 1, 1)
        const end = new Date(year, mon, 0, 23, 59, 59, 999)
        where.date = { gte: start, lte: end }
      }

      if (staffId) where.staffId = staffId

      const records = await db.staffAttendance.findMany({
        where,
        include: { staff: { select: { name: true, department: true } } },
        orderBy: { date: 'desc' },
      })

      return NextResponse.json({ records })
    }

    // Update an attendance record (manual correction)
    if (action === 'update') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id, data } = body
      // Recalculate working hours if check-in/check-out changed
      if (data.checkIn && data.checkOut) {
        const diffMs = new Date(data.checkOut).getTime() - new Date(data.checkIn).getTime()
        data.workingHours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100
        data.workingHours = Math.max(0, data.workingHours)
      }
      const updated = await db.staffAttendance.update({ where: { id }, data })
      triggerAutoBackup(tenantId, 'attendance:update')
      return NextResponse.json({ attendance: updated })
    }

    // Monthly summary
    if (action === 'monthly-summary') {
      const { month } = body // format: "2025-03"
      const [year, mon] = month.split('-').map(Number)
      const start = new Date(year, mon - 1, 1)
      const end = new Date(year, mon, 0, 23, 59, 59, 999)

      // Get all active staff
      const staffList = await db.staff.findMany({
        where: { tenantId, isDeleted: false, isActive: true },
        select: { id: true, name: true, department: true },
      })

      // Get attendance records for the month
      const records = await db.staffAttendance.findMany({
        where: { tenantId, isDeleted: false, date: { gte: start, lte: end } },
      })

      // Build summary per staff member
      const summary = staffList.map((staff) => {
        const staffRecords = records.filter((r) => r.staffId === staff.id)
        const present = staffRecords.filter((r) => r.status === 'PRESENT').length
        const absent = staffRecords.filter((r) => r.status === 'ABSENT').length
        const halfDay = staffRecords.filter((r) => r.status === 'HALF_DAY').length
        const leave = staffRecords.filter((r) => r.status === 'LEAVE').length
        const holiday = staffRecords.filter((r) => r.status === 'HOLIDAY').length
        const totalWorkingHours = staffRecords.reduce((sum, r) => sum + (r.workingHours || 0), 0)
        return {
          staffId: staff.id,
          staffName: staff.name,
          department: staff.department,
          present,
          absent,
          halfDay,
          leave,
          holiday,
          totalWorkingHours: Math.round(totalWorkingHours * 100) / 100,
        }
      })

      return NextResponse.json({ summary, month, totalStaff: staffList.length })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Attendance error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
