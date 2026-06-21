import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// ============================================================
// v4.56: PostgreSQL connection (was SQLite)
// ============================================================
// DATABASE_URL is now a PostgreSQL connection string:
//   postgresql://user:password@host:port/dbname
//
// No more file path resolution, no more SQLite PRAGMA optimizations,
// no more volume mount symlinks. PostgreSQL is a network database.
//
// PM2 cluster mode: each worker process creates its own PrismaClient.
// connection_limit=5 per worker × 2 workers = 10 max connections.
// PostgreSQL on Railway supports 100+ connections — well within limits.
// ============================================================

const databaseUrl = process.env.DATABASE_URL || ''
if (!databaseUrl) {
  console.error('[DB] FATAL: DATABASE_URL is not set!')
  console.error('[DB] Set DATABASE_URL to a PostgreSQL connection string:')
  console.error('[DB]   postgresql://user:password@host:port/dbname')
}

// v4.56: Connection pool settings for PM2 cluster mode
// Each PM2 worker gets 5 connections. With 2 workers = 10 total.
// Add pg_bouncer mode if available (transaction pooling).
const connectionUrl = databaseUrl
  ? databaseUrl + (databaseUrl.includes('?') ? '&' : '?') + 'connection_limit=5&pool_timeout=30'
  : databaseUrl

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
    ],
    datasources: {
      db: {
        url: connectionUrl,
      },
    },
  })

// Log all hard-delete operations for audit trail (soft-deletes are the norm now)
if (!globalForPrisma.prisma) {
  // @ts-ignore - Prisma event types
  db.$on('query', (e: { query: string; duration: number }) => {
    const q = e.query.toLowerCase().trim()
    if (q.startsWith('delete') || q.includes('delete from')) {
      console.warn(`[DB-PROTECTION] HARD DELETE operation detected! Should use soft-delete: ${e.query.slice(0, 300)}...`)
    }
  })

  // v4.56: No more SQLite PRAGMA optimizations — PostgreSQL handles this internally
  // v4.56: No more file-based backup — PostgreSQL manages its own persistence
  console.log('[DB] PostgreSQL Prisma client initialized')
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
