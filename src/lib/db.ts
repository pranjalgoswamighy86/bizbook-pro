import { PrismaClient } from '@prisma/client'
import path from 'path'
import fs from 'fs'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// ============================================================
// Smart DATABASE_URL resolution
// ============================================================
// The DATABASE_URL must work in ALL environments:
//   1. Local dev:   file:/home/z/my-project/db/custom.db (from .env)
//   2. PM2 cluster: file:/home/z/my-project/db/custom.db (from ecosystem.config.js)
//   3. Space-Z deploy: file:/app/db/custom.db (from start.sh)
//   4. Standalone:  file:./db/custom.db (relative fallback)
//
// Priority: env var > .env file > auto-detect
// ============================================================
function resolveDatabaseUrl(): string {
  const envUrl = process.env.DATABASE_URL
  
  // Helper: resolve a file: URL to an absolute path for Prisma
  // Prisma SQLite requires absolute paths — relative paths fail in standalone mode
  const toAbsoluteUrl = (url: string): string => {
    if (!url.startsWith('file:')) return url
    let filePath = url.replace(/^file:/, '')
    // If the path is relative, resolve it from CWD to absolute
    if (!path.isAbsolute(filePath)) {
      filePath = path.resolve(process.cwd(), filePath)
    }
    return `file:${filePath}`
  }
  
  if (envUrl) {
    // Convert to absolute path and verify the database file exists
    const absoluteUrl = toAbsoluteUrl(envUrl)
    const dbPath = absoluteUrl.replace(/^file:/, '')
    if (fs.existsSync(dbPath)) {
      return absoluteUrl
    }
    // File doesn't exist at the specified path — try fallbacks
    console.warn(`[DB] Database not found at ${dbPath}, trying fallbacks...`)
  }

  // Fallback 1: relative to CWD
  const cwdPath = path.join(process.cwd(), 'db', 'custom.db')
  if (fs.existsSync(cwdPath)) {
    console.log(`[DB] Using database at: ${cwdPath}`)
    return `file:${cwdPath}`
  }

  // Fallback 2: common deployed paths
  const deployPaths = [
    '/app/db/custom.db',           // Space-Z platform
    '/home/z/my-project/db/custom.db', // Local dev/PM2
  ]
  for (const p of deployPaths) {
    if (fs.existsSync(p)) {
      console.log(`[DB] Using database at: ${p}`)
      return `file:${p}`
    }
  }

  // Fallback 3: use the env var anyway (Prisma will create the DB if needed)
  console.warn('[DB] Could not find database file, using configured URL')
  return envUrl || 'file:./db/custom.db'
}

const resolvedDatabaseUrl = resolveDatabaseUrl()

// Create Prisma client with optimized connection settings for cluster mode
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
    ],
    datasources: {
      db: {
        url: resolvedDatabaseUrl,
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

  // Enable SQLite WAL mode and performance optimizations
  // ALL errors are non-fatal — the app works fine without these optimizations
  async function optimizeDatabase() {
    const optimizations = [
      { name: 'WAL mode', sql: 'PRAGMA journal_mode=WAL' },
      { name: 'busy_timeout=10000ms', sql: 'PRAGMA busy_timeout=10000' },
      { name: 'synchronous=NORMAL', sql: 'PRAGMA synchronous=NORMAL' },
      { name: 'cache_size=128MB', sql: 'PRAGMA cache_size=-131072' },
      { name: 'temp_store=MEMORY', sql: 'PRAGMA temp_store=MEMORY' },
      { name: 'mmap_size=256MB', sql: 'PRAGMA mmap_size=268435456' },
    ]

    for (const opt of optimizations) {
      try {
        await db.$queryRawUnsafe(opt.sql)
        console.log(`[DB-OPTIMIZE] ${opt.name} — enabled`)
      } catch (err: any) {
        // PRAGMA journal_mode=WAL returns a result row which causes
        // "Execute returned results" error — but the PRAGMA actually succeeded
        const msg = err?.message || ''
        if (msg.includes('returned results') || msg.includes('already in sync')) {
          console.log(`[DB-OPTIMIZE] ${opt.name} — enabled`)
        } else {
          // Non-fatal: the app works fine without these optimizations
          console.log(`[DB-OPTIMIZE] ${opt.name} — skipped (non-fatal)`)
        }
      }
    }
  }

  // Run optimizations in background — never block server startup
  optimizeDatabase().catch(() => {})

  // Auto-backup on server startup — fully async and non-blocking
  // Uses dynamic import() instead of require() to avoid circular dependency
  // and temporal dead zone errors in minified production code
  ;(async () => {
    try {
      const { backupDatabase } = await import('./db-protection')
      // Run backup in a microtask to avoid blocking Prisma initialization
      await new Promise(resolve => setTimeout(resolve, 1000))
      const result = backupDatabase('startup')
      if (result.success) {
        console.log('[DB-PROTECTION] Startup backup created successfully')
      } else {
        console.warn('[DB-PROTECTION] Startup backup skipped:', result.error)
      }
    } catch (err) {
      // Non-fatal: backup failure should never prevent the app from starting
      console.warn('[DB-PROTECTION] Startup backup failed (non-fatal):', err)
    }
  })()
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
