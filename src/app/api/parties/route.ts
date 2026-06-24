import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'

// Helper: sync Party data to Debtor/Creditor models
async function syncToDebtorCreditor(
  tenantId: string,
  name: string,
  data: { phone?: string | null; email?: string | null; address?: string | null; gstNumber?: string | null },
  type: string,
  openingBalance?: number,
  currentBalanceAdjustment?: number
) {
  const syncData = {
    phone: data.phone ?? null,
    email: data.email ?? null,
    address: data.address ?? null,
    gstNumber: data.gstNumber ?? null,
  }

  // If CUSTOMER or BOTH → upsert Debtor
  if (type === 'CUSTOMER' || type === 'BOTH') {
    const existingDebtor = await db.debtor.findFirst({ where: { name, tenantId, isDeleted: false } })
    if (existingDebtor) {
      const updateData: Record<string, unknown> = { ...syncData }
      if (openingBalance !== undefined) {
        updateData.openingBalance = openingBalance
      }
      if (currentBalanceAdjustment !== undefined) {
        updateData.currentBalance = existingDebtor.currentBalance + currentBalanceAdjustment
      }
      await db.debtor.update({ where: { id: existingDebtor.id }, data: updateData })
    } else {
      await db.debtor.create({
        data: {
          name,
          tenantId,
          ...syncData,
          openingBalance: openingBalance ?? 0,
          currentBalance: openingBalance ?? 0,
        },
      })
    }
  }

  // If SUPPLIER or BOTH → upsert Creditor
  if (type === 'SUPPLIER' || type === 'BOTH') {
    const existingCreditor = await db.creditor.findFirst({ where: { name, tenantId, isDeleted: false } })
    if (existingCreditor) {
      const updateData: Record<string, unknown> = { ...syncData }
      if (openingBalance !== undefined) {
        updateData.openingBalance = openingBalance
      }
      if (currentBalanceAdjustment !== undefined) {
        updateData.currentBalance = existingCreditor.currentBalance + currentBalanceAdjustment
      }
      await db.creditor.update({ where: { id: existingCreditor.id }, data: updateData })
    } else {
      await db.creditor.create({
        data: {
          name,
          tenantId,
          ...syncData,
          openingBalance: openingBalance ?? 0,
          currentBalance: openingBalance ?? 0,
        },
      })
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body

    // ── CREATE ──────────────────────────────────────────────
    if (action === 'create') {
      const { tenantId, data } = body

      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const openingBalance = data.openingBalance ?? 0

      try {
        const party = await db.party.create({
          data: {
            name: data.name,
            phone: data.phone ?? null,
            email: data.email ?? null,
            address: data.address ?? null,
            gstNumber: data.gstNumber ?? null,
            panNumber: data.panNumber ?? null,
            type: data.type ?? 'BOTH',
            openingBalance,
            currentBalance: openingBalance,
            tenantId,
          },
        })

        // Sync to Debtor/Creditor
        await syncToDebtorCreditor(
          tenantId,
          party.name,
          { phone: party.phone, email: party.email, address: party.address, gstNumber: party.gstNumber },
          party.type,
          openingBalance
        )

        return NextResponse.json({ party })
      } catch (error: unknown) {
        // Handle unique constraint violation (name + tenantId)
        const prismaError = error as { code?: string; meta?: { target?: string[] } }
        if (prismaError.code === 'P2002') {
          // Return existing party if name+tenantId already exists
          const existing = await db.party.findFirst({
            where: { name: data.name, tenantId, isDeleted: false },
          })
          if (existing) {
            return NextResponse.json({ party: existing })
          }
        }
        throw error
      }
    }

    // ── UPDATE ──────────────────────────────────────────────
    if (action === 'update') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id, data } = body

      // Fetch current party to compute balance adjustment
      const current = await db.party.findUnique({ where: { id } })
      if (!current) {
        return NextResponse.json({ error: 'Party not found' }, { status: 404 })
      }

      const updateData: Record<string, unknown> = { ...data }

      // If openingBalance is being updated, adjust currentBalance by the difference
      if (data.openingBalance !== undefined && data.openingBalance !== current.openingBalance) {
        const diff = data.openingBalance - current.openingBalance
        updateData.currentBalance = current.currentBalance + diff
      }

      const party = await db.party.update({
        where: { id },
        data: updateData,
      })

      // Sync to Debtor/Creditor
      const effectiveType = data.type ?? current.type
      const balanceAdjustment =
        data.openingBalance !== undefined && data.openingBalance !== current.openingBalance
          ? data.openingBalance - current.openingBalance
          : undefined

      await syncToDebtorCreditor(
        current.tenantId,
        party.name,
        {
          phone: data.phone ?? party.phone,
          email: data.email ?? party.email,
          address: data.address ?? party.address,
          gstNumber: data.gstNumber ?? party.gstNumber,
        },
        effectiveType,
        data.openingBalance,
        balanceAdjustment
      )

      return NextResponse.json({ party })
    }

    // ── DELETE ──────────────────────────────────────────────
    if (action === 'delete') {
      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const { id } = body

      // Fetch party before deletion so we can also clean up Debtor/Creditor
      const party = await db.party.findUnique({ where: { id } })
      if (party) {
        // Remove linked Debtor if exists
        if (party.type === 'CUSTOMER' || party.type === 'BOTH') {
          const debtor = await db.debtor.findFirst({ where: { name: party.name, tenantId: party.tenantId, isDeleted: false } })
          if (debtor) {
            await db.debtor.update({ where: { id: debtor.id }, data: { isDeleted: true, deletedAt: new Date() } })
          }
        }
        // Remove linked Creditor if exists
        if (party.type === 'SUPPLIER' || party.type === 'BOTH') {
          const creditor = await db.creditor.findFirst({ where: { name: party.name, tenantId: party.tenantId, isDeleted: false } })
          if (creditor) {
            await db.creditor.update({ where: { id: creditor.id }, data: { isDeleted: true, deletedAt: new Date() } })
          }
        }
      }

      await db.party.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } })
      return NextResponse.json({ success: true })
    }

    // ── LIST ────────────────────────────────────────────────
    if (action === 'list') {
      const { tenantId, search, type } = body

      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      const where: Record<string, unknown> = { tenantId, isDeleted: false }

      if (type) {
        where.type = type
      }

      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { gstNumber: { contains: search, mode: 'insensitive' } },
        ]
      }

      const [parties, total] = await Promise.all([
        db.party.findMany({ where, orderBy: { name: 'asc' } }),
        db.party.count({ where }),
      ])

      return NextResponse.json({ parties, total })
    }

    // ── SEARCH (autocomplete) ───────────────────────────────
    if (action === 'search') {
      const { tenantId, query } = body

      // ---- SECURITY PATCH v1: auth + tenant access ----
      const access = await requireAuthAndTenant(req, tenantId)
      if (access instanceof NextResponse) return access
      // --------------------------------------------------

      if (!query || query.trim().length === 0) {
        return NextResponse.json({ suggestions: [] })
      }

      const parties = await db.party.findMany({
        where: {
          tenantId,
          isDeleted: false,
          name: { contains: query, mode: 'insensitive' },
        },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          address: true,
          gstNumber: true,
          type: true,
        },
        orderBy: { name: 'asc' },
        take: 20,
      })

      return NextResponse.json({ suggestions: parties })
    }

    // ── GET-OR-CREATE ───────────────────────────────────────
    if (action === 'get-or-create') {
      const { tenantId, name, phone, email, address, gstNumber } = body

      // Try to find existing party by name+tenantId
      const existing = await db.party.findFirst({
        where: { name, tenantId, isDeleted: false },
      })

      if (existing) {
        // Optionally update fields if provided
        const updateFields: Record<string, unknown> = {}
        if (phone && !existing.phone) updateFields.phone = phone
        if (email && !existing.email) updateFields.email = email
        if (address && !existing.address) updateFields.address = address
        if (gstNumber && !existing.gstNumber) updateFields.gstNumber = gstNumber

        if (Object.keys(updateFields).length > 0) {
          const updated = await db.party.update({
            where: { id: existing.id },
            data: updateFields,
          })

          // Sync updated info to Debtor/Creditor
          await syncToDebtorCreditor(
            tenantId,
            updated.name,
            { phone: updated.phone, email: updated.email, address: updated.address, gstNumber: updated.gstNumber },
            updated.type
          )

          return NextResponse.json({ party: updated })
        }

        return NextResponse.json({ party: existing })
      }

      // Create new party
      const party = await db.party.create({
        data: {
          name,
          phone: phone ?? null,
          email: email ?? null,
          address: address ?? null,
          gstNumber: gstNumber ?? null,
          type: 'BOTH',
          openingBalance: 0,
          currentBalance: 0,
          tenantId,
        },
      })

      // Sync to both Debtor and Creditor (default type is BOTH)
      await syncToDebtorCreditor(
        tenantId,
        party.name,
        { phone: party.phone, email: party.email, address: party.address, gstNumber: party.gstNumber },
        party.type,
        0
      )

      return NextResponse.json({ party })
    }

    // ── UPDATE-BALANCE ──────────────────────────────────────
    if (action === 'update-balance') {
      const { tenantId, partyName, amount, direction } = body

      const party = await db.party.findFirst({
        where: { name: partyName, tenantId, isDeleted: false },
      })

      if (!party) {
        return NextResponse.json({ error: 'Party not found' }, { status: 404 })
      }

      const adjustment = direction === 'increase' ? Math.abs(amount) : -Math.abs(amount)
      const newBalance = party.currentBalance + adjustment

      const updated = await db.party.update({
        where: { id: party.id },
        data: { currentBalance: newBalance },
      })

      // Also update linked Debtor/Creditor
      if (party.type === 'CUSTOMER' || party.type === 'BOTH') {
        const debtor = await db.debtor.findFirst({ where: { name: partyName, tenantId, isDeleted: false } })
        if (debtor) {
          await db.debtor.update({
            where: { id: debtor.id },
            data: { currentBalance: debtor.currentBalance + adjustment },
          })
        }
      }

      if (party.type === 'SUPPLIER' || party.type === 'BOTH') {
        const creditor = await db.creditor.findFirst({ where: { name: partyName, tenantId, isDeleted: false } })
        if (creditor) {
          await db.creditor.update({
            where: { id: creditor.id },
            data: { currentBalance: creditor.currentBalance + adjustment },
          })
        }
      }

      return NextResponse.json({ party: updated })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Parties error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
