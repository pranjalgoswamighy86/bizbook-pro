/**
 * BizBook Pro — Optimistic Locking Helper (Security Patch v2)
 *
 * Fixes:
 *   🟠 H6 — Concurrent updates race condition.
 *           Two users editing the same record → last writer wins, earlier
 *           writer's changes silently lost. This helper detects conflicts
 *           and returns a 409 Conflict instead.
 *
 * Requires:
 *   - A `version Int @default(0)` field on the model (see schema patch)
 *   - The client sends the `version` they read with the update
 *
 * Usage:
 *   import { updateWithOptimisticLock, ConflictError } from '@/lib/optimistic-lock'
 *
 *   try {
 *     const updated = await updateWithOptimisticLock(
 *       db.sale,
 *       id,
 *       currentVersion,        // from the client
 *       updateData,
 *       'Sale'                 // entity type for error message
 *     )
 *     return NextResponse.json({ sale: updated })
 *   } catch (e) {
 *     if (e instanceof ConflictError) {
 *       return NextResponse.json(
 *         { error: e.message, code: 'CONFLICT' },
 *         { status: 409 }
 *       )
 *     }
 *     throw e
 *   }
 *
 * Schema change required (add to high-contention models in schema.prisma):
 *   model Sale {
 *     ...
 *     version Int @default(0)
 *   }
 *
 * Then run: npx prisma db push
 */

import { NextResponse } from 'next/server'

/**
 * Custom error for optimistic lock conflicts.
 * The route handler should catch this and return HTTP 409.
 */
export class ConflictError extends Error {
  public readonly entityType: string
  public readonly entityId: string
  public readonly expectedVersion: number

  constructor(entityType: string, entityId: string, expectedVersion: number) {
    super(
      `${entityType} ${entityId} was modified by another user. ` +
      `Expected version ${expectedVersion}, but the record has been updated. ` +
      `Please refresh and try again.`
    )
    this.name = 'ConflictError'
    this.entityType = entityType
    this.entityId = entityId
    this.expectedVersion = expectedVersion
  }
}

/**
 * Type for a Prisma model delegate that has a `version` field and supports
 * `update` with a compound `where` clause.
 */
interface VersionedModelDelegate {
  update: (args: {
    where: { id: string; version: number }
    data: Record<string, unknown>
  }) => Promise<Record<string, unknown> & { id: string; version: number }>
  findUnique: (args: {
    where: { id: string }
  }) => Promise<(Record<string, unknown> & { id: string; version: number }) | null>
}

/**
 * Perform an update with optimistic locking.
 *
 * @param model     — The Prisma model delegate (e.g., `db.sale`)
 * @param id        — The record ID
 * @param expectedVersion — The version the client read (from the GET response)
 * @param data      — The fields to update
 * @param entityType — Human-readable entity name for error messages
 * @returns The updated record (with incremented version)
 * @throws ConflictError if the version doesn't match
 */
export async function updateWithOptimisticLock(
  model: VersionedModelDelegate,
  id: string,
  expectedVersion: number,
  data: Record<string, unknown>,
  entityType: string = 'Record'
): Promise<Record<string, unknown> & { id: string; version: number }> {
  // Use a compound where clause: { id, version: expectedVersion }
  // If the version in the DB doesn't match expectedVersion, this update
  // affects 0 rows and Prisma throws P2025 "Record to update not found".
  try {
    const updated = await model.update({
      where: { id, version: expectedVersion },
      data: {
        ...data,
        version: { increment: 1 },
      },
    })
    return updated
  } catch (error: any) {
    // Prisma P2025: "Record to update not found" — means version mismatch
    if (error?.code === 'P2025') {
      // Verify the record still exists (vs. was hard-deleted)
      const existing = await model.findUnique({ where: { id } })
      if (existing) {
        // Record exists but version doesn't match → concurrent modification
        throw new ConflictError(entityType, id, expectedVersion)
      }
      // Record doesn't exist at all → let the caller handle the 404
      throw new Error(`${entityType} ${id} not found`)
    }
    throw error
  }
}

/**
 * Express/Next.js error handler for ConflictError.
 * Returns a 409 response with a user-friendly message.
 */
export function handleConflictError(error: unknown): NextResponse | null {
  if (error instanceof ConflictError) {
    return NextResponse.json(
      {
        error: error.message,
        code: 'CONFLICT',
        entityType: error.entityType,
        entityId: error.entityId,
        expectedVersion: error.expectedVersion,
      },
      { status: 409 }
    )
  }
  return null
}

/**
 * Convenience: wrap a handler that might throw ConflictError.
 *
 * Usage:
 *   return withConflictHandling(async () => {
 *     const updated = await updateWithOptimisticLock(db.sale, id, version, data)
 *     return NextResponse.json({ sale: updated })
 *   })
 */
export async function withConflictHandling(
  fn: () => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    return await fn()
  } catch (error) {
    const conflictResponse = handleConflictError(error)
    if (conflictResponse) return conflictResponse
    throw error
  }
}
