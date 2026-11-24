#!/usr/bin/env node
/**
 * BizBook Pro — Password Migration Script (Security Patch v1)
 *
 * Converts all existing plaintext passwords in the User table to scrypt hashes.
 * Safe to run multiple times — it skips users whose password is already hashed.
 *
 * Preserves each user's current password while converting legacy plaintext
 * values to scrypt hashes. It never creates or resets any administrator
 * credentials.
 *
 * Usage:
 *   node scripts/migrate-passwords.js                # uses the local SQLite database
 *   node scripts/migrate-passwords.js ./db/custom.db # explicit path
 *
 * Existing accounts retain their current password. Create new admin accounts
 * through the verified registration flow or a separately controlled setup process.
 */

const crypto = require('crypto')
const path = require('path')
const fs = require('fs')

// Same constants as src/lib/auth.ts
const SCRYPT_KEYLEN = 64
const SCRYPT_SALT_BYTES = 16

function hashPassword(password) {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES)
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN)
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

function isPasswordHashed(stored) {
  if (!stored) return false
  const parts = stored.split(':')
  if (parts.length !== 2) return false
  const [salt, hash] = parts
  return /^[0-9a-f]+$/i.test(salt) && /^[0-9a-f]+$/i.test(hash) &&
    salt.length === SCRYPT_SALT_BYTES * 2 && hash.length === SCRYPT_KEYLEN * 2
}

// ============================================================
// Resolve DB path
// ============================================================
function resolveDbPath() {
  if (process.argv[2]) {
    return path.resolve(process.argv[2])
  }
  const envUrl = process.env.DATABASE_URL || ''
  if (envUrl.startsWith('file:')) {
    const p = envUrl.replace('file:', '')
    return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
  }
  // Fallback: look for ./db/custom.db
  const fallback = path.join(process.cwd(), 'db', 'custom.db')
  return fallback
}

// ============================================================
// Main
// ============================================================
async function main() {
  const dbPath = resolveDbPath()

  console.log('============================================')
  console.log('  BizBook Pro — Password Migration')
  console.log('============================================')
  console.log('DB path:', dbPath)

  if (!fs.existsSync(dbPath)) {
    console.error('ERROR: Database file not found at', dbPath)
    console.error('Pass the path explicitly:  node scripts/migrate-passwords.js /path/to/custom.db')
    process.exit(1)
  }

  // Load Prisma client (use the bundled one in node_modules)
  const { PrismaClient } = require('@prisma/client')
  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } },
  })

  try {
    const users = await prisma.user.findMany()
    console.log(`Found ${users.length} user(s)`)

    let migrated = 0
    let skipped = 0

    for (const user of users) {
      if (isPasswordHashed(user.password)) {
        console.log(`  SKIP  ${user.email}  (already hashed)`)
        skipped++
        continue
      }

      // The stored password is plaintext — re-hash it preserving the same
      // value (so users keep their existing passwords after migration).
      const newHash = hashPassword(user.password)

      await prisma.user.update({
        where: { id: user.id },
        data: { password: newHash },
      })

      console.log(`  OK    ${user.email}  (hashed)`)
      migrated++
    }

    console.log('')
    console.log('============================================')
    console.log('  Migration complete')
    console.log('============================================')
    console.log(`  Migrated:   ${migrated}`)
    console.log(`  Skipped:    ${skipped}  (already hashed)`)
    console.log('')
    console.log("Next step: start the server and sign in with each user\u0027s existing password.")
    console.log('')

    // IMPORTANT: Set SESSION_SECRET in .env so session tokens survive restarts
    const envPath = path.join(process.cwd(), '.env')
    if (fs.existsSync(envPath)) {
      const envContents = fs.readFileSync(envPath, 'utf-8')
      if (!envContents.includes('SESSION_SECRET')) {
        const generatedSecret = crypto.randomBytes(32).toString('hex')
        fs.appendFileSync(envPath, `\n# Added by security patch — do NOT change after first deploy\nSESSION_SECRET="${generatedSecret}"\n`)
        console.log(`  ✓ Added SESSION_SECRET to ${envPath}`)
        console.log(`    (Save this value — if you lose it, all sessions invalidate)`)
      } else {
        console.log(`  ✓ SESSION_SECRET already set in ${envPath}`)
      }
    } else {
      console.log(`  ⚠ No .env file found — create one with:`)
      console.log(`    SESSION_SECRET="${crypto.randomBytes(32).toString('hex')}"`)
    }
    console.log('')
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
