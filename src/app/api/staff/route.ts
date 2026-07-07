import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'
// v4.159: triggerAutoBackup after salary payment
import { triggerAutoBackup } from '@/lib/auto-backup'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, tenantId } = body

    if (action === 'create') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const staff = await db.staff.create({ data: { ...body.data, tenantId } })
      return NextResponse.json({ staff })
    }

    if (action === 'update') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id, data } = body
      const staff = await db.staff.update({ where: { id }, data })
      return NextResponse.json({ staff })
    }

    if (action === 'delete') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id } = body
      await db.staff.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } })
      return NextResponse.json({ success: true })
    }

    if (action === 'list') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { search, department, activeOnly } = body
      const where: Record<string, unknown> = { tenantId, isDeleted: false }
      if (search) {
        where.OR = [
          { name: { contains: search } },
          { phone: { contains: search } },
          { department: { contains: search } },
        ]
      }
      if (department) where.department = department
      if (activeOnly) where.isActive = true

      const staffList = await db.staff.findMany({
        where,
        include: { salaryPayments: { orderBy: { paidDate: 'desc' }, take: 3 } },
        orderBy: { name: 'asc' },
      })
      return NextResponse.json({ staff: staffList })
    }

    // ============================================================
    // v4.159: PAY-SALARY — completely rewritten with:
    //   1. Auth check (was missing — security hole)
    //   2. db.$transaction wrapper (atomic)
    //   3. Journal entry: Dr Salary Expense / Cr Cash (if paid) or Cr Creditors (if due)
    //   4. Creditor creation if salary is DUE (unpaid)
    //   5. Audit log
    //   6. triggerAutoBackup
    // ============================================================
    if (action === 'pay-salary') {
      const access = await requireAuthAndRole(req, tenantId, ['JUNIOR_ADMIN', 'MAIN_ADMIN'])
      if (access instanceof NextResponse) return access

      const { staffId, month, amount, paidDate, paymentMode, notes, isDue } = body
      const numAmount = Number(amount) || 0
      if (numAmount <= 0) {
        return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 400 })
      }

      const staff = await db.staff.findFirst({
        where: { id: staffId, tenantId: access.tenantId, isDeleted: false },
      })
      if (!staff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 })

      // Use transaction for atomicity — salary payment + journal entry + creditor must all succeed or all fail
      const payment = await db.$transaction(async (tx) => {
        // 1. Create salary payment record
        const salaryPayment = await tx.salaryPayment.create({
          data: {
            staffId,
            month,
            amount: numAmount,
            paidDate: new Date(paidDate || new Date()),
            paymentMode: paymentMode || (isDue ? 'UNPAID' : 'CASH'),
            notes: notes || null,
            tenantId: access.tenantId,
          },
        })

        // 2. Journal entry: Dr Salary Expense (50400) / Cr Cash (10100) or Cr Creditors (20100)
        const accounts = await tx.account.findMany({ where: { tenantId: access.tenantId } })
        if (accounts.length > 0) {
          const findAccount = (code: string) => accounts.find(a => a.accountCode === code)
          let salaryAccount = findAccount('50400')
          let cashAccount = findAccount('10100')
          let creditorsAccount = findAccount('20100')

          if (!salaryAccount) salaryAccount = await tx.account.create({ data: { accountCode: '50400', name: 'Salary Expense', type: 'Expense', tenantId: access.tenantId } })
          if (!cashAccount) cashAccount = await tx.account.create({ data: { accountCode: '10100', name: 'Cash', type: 'Asset', tenantId: access.tenantId } })
          if (!creditorsAccount) creditorsAccount = await tx.account.create({ data: { accountCode: '20100', name: 'Accounts Payable', type: 'Liability', tenantId: access.tenantId } })

          const isUnpaid = isDue || paymentMode === 'UNPAID' || paymentMode === 'DUE'
          const jeLines = [
            {
              accountId: salaryAccount!.id,
              debit: numAmount,
              credit: 0,
              description: `Salary for ${staff.name} - ${month}`,
            },
            {
              accountId: isUnpaid ? creditorsAccount!.id : cashAccount!.id,
              debit: 0,
              credit: numAmount,
              description: isUnpaid
                ? `Salary due to ${staff.name} for ${month}`
                : `Cash paid to ${staff.name} for ${month}`,
            },
          ]

          await tx.journalEntry.create({
            data: {
              entryDate: new Date(paidDate || new Date()),
              reference: `SAL/${month}/${staff.name.slice(0, 10)}`,
              description: `Salary payment - ${staff.name} - ${month}`,
              sourceType: 'SALARY',
              sourceId: salaryPayment.id,
              isPosted: true,
              tenantId: access.tenantId,
              createdBy: access.userId,
              lines: { create: jeLines },
            },
          })
        }

        // 3. If salary is DUE (unpaid), create/update Creditor entry
        if (isDue || paymentMode === 'UNPAID' || paymentMode === 'DUE') {
          const existingCreditor = await tx.creditor.findFirst({
            where: { name: staff.name, tenantId: access.tenantId, isDeleted: false },
          })
          if (existingCreditor) {
            await tx.creditor.update({
              where: { id: existingCreditor.id },
              data: { currentBalance: existingCreditor.currentBalance + numAmount },
            })
          } else {
            await tx.creditor.create({
              data: {
                name: staff.name,
                phone: staff.phone || null,
                currentBalance: numAmount,
                tenantId: access.tenantId,
              },
            })
          }
        }

        // 4. Audit log
        await tx.auditLog.create({
          data: {
            tenantId: access.tenantId,
            userId: access.userId,
            userName: access.user.name,
            action: 'CREATE',
            entityType: 'SalaryPayment',
            entityId: salaryPayment.id,
            entityName: `Salary - ${staff.name} - ${month}`,
            changes: JSON.stringify({ amount: numAmount, month, paymentMode, isDue: !!isDue }),
          },
        })

        return salaryPayment
      })

      // 5. Auto-backup (fire-and-forget, outside transaction)
      triggerAutoBackup(tenantId, 'salary:pay')

      return NextResponse.json({ payment, success: true })
    }

    if (action === 'salary-history') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { staffId } = body
      const payments = await db.salaryPayment.findMany({
        where: { staffId },
        orderBy: { paidDate: 'desc' },
      })
      return NextResponse.json({ payments })
    }

    // ============================================================
    // v6.5: SET USAGE LIMIT — Main admin sets monthly hour limit for a user
    // ============================================================
    if (action === 'set-usage-limit') {
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN'])
      if (access instanceof NextResponse) return access

      const { targetUserId, maxSecondsPerMonth } = body
      if (!targetUserId) {
        return NextResponse.json({ error: 'targetUserId is required' }, { status: 400 })
      }

      // Validate that target user is in this tenant
      const targetUserTenant = await db.userTenant.findUnique({
        where: { userId_tenantId: { userId: targetUserId, tenantId } },
      })
      if (!targetUserTenant) {
        return NextResponse.json({ error: 'User not found in this company' }, { status: 404 })
      }

      // MAIN_ADMIN can set limits for all non-view users
      // JUNIOR_ADMIN can only set limits for DATA_ENTRY users (but this route requires MAIN_ADMIN)
      await db.userTenant.update({
        where: { userId_tenantId: { userId: targetUserId, tenantId } },
        data: {
          maxSecondsPerMonth: maxSecondsPerMonth || null, // null = unlimited
          limitSetBy: access.userId,
          limitSetAt: new Date(),
        },
      })

      await writeAuditLog({
        tenantId,
        userId: access.userId,
        userName: access.user.name,
        action: 'UPDATE',
        entityType: 'UserLimit',
        entityId: targetUserId,
        entityName: `Set limit to ${maxSecondsPerMonth ? Math.floor(maxSecondsPerMonth / 3600) + 'h' : 'unlimited'}`,
      })

      return NextResponse.json({ success: true, message: 'Usage limit updated' })
    }

    // ============================================================
    // v6.5: GET USAGE LIMITS — Get all users with their limits
    // ============================================================
    if (action === 'get-usage-limits') {
      const access = await requireAuthAndRole(req, tenantId, ['MAIN_ADMIN', 'JUNIOR_ADMIN'])
      if (access instanceof NextResponse) return access

      // JUNIOR_ADMIN can only see DATA_ENTRY users' limits
      // MAIN_ADMIN can see all users' limits
      const roleFilter = access.role === 'JUNIOR_ADMIN'
        ? { role: 'DATA_ENTRY' as const }
        : {}

      const userTenants = await db.userTenant.findMany({
        where: { tenantId, ...roleFilter },
        include: { user: true },
      })

      // Get monthly usage for each user
      const monthStart = new Date()
      monthStart.setDate(1)
      monthStart.setHours(0, 0, 0, 0)

      const usersWithUsage = await Promise.all(
        userTenants.map(async (ut) => {
          const usage = await db.usageLog.aggregate({
            where: {
              userId: ut.userId,
              loggedAt: { gte: monthStart },
            },
            _sum: { secondsUsed: true },
          })
          return {
            userId: ut.userId,
            userName: ut.user.name,
            email: ut.user.email,
            role: ut.role,
            maxSecondsPerMonth: ut.maxSecondsPerMonth,
            limitSetBy: ut.limitSetBy,
            limitSetAt: ut.limitSetAt,
            usedThisMonth: usage._sum.secondsUsed || 0,
          }
        })
      )

      return NextResponse.json({ users: usersWithUsage })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Staff error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
