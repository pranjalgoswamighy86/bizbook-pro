#!/usr/bin/env node
/**
 * verify-standalone.js — Pre-flight check that runs BEFORE the production
 * server starts. Confirms that the standalone build is complete and that
 * the public/ and .next/static/ assets are present, so users never see
 * a 404 on /_next/static/* after deployment.
 *
 * Exit codes:
 *   0 = all checks passed
 *   1 = critical check failed — refuse to start server
 *
 * Used by:
 *   - start.sh (Linux/macOS)
 *   - START.bat (Windows)
 *   - Docker ENTRYPOINT (optional)
 *   - CI/CD pipelines
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
let standaloneDir = args[0] || path.join(process.cwd(), '.next', 'standalone');

function log(msg) { console.log('[verify] ' + msg); }
function ok(msg) { console.log('[verify] OK    ' + msg); }
function warn(msg) { console.warn('[verify] WARN  ' + msg); }
function fail(msg) { console.error('[verify] FAIL  ' + msg); }

function countFiles(dir) {
  let count = 0;
  if (!fs.existsSync(dir)) return 0;
  const walk = (p) => {
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(p, entry.name));
      else count++;
    }
  };
  walk(dir);
  return count;
}

let failures = 0;
let warnings = 0;

function check(label, condition, onFail) {
  if (condition) {
    ok(label);
  } else {
    fail(label);
    failures++;
    if (onFail) onFail();
  }
}

function warnCheck(label, condition) {
  if (condition) {
    ok(label);
  } else {
    warn(label);
    warnings++;
  }
}

log('Verifying standalone build at: ' + standaloneDir);

// Critical checks (failure = exit 1)
check('standalone/ directory exists', fs.existsSync(standaloneDir));
check('standalone/server.js exists', fs.existsSync(path.join(standaloneDir, 'server.js')));
check('standalone/.next/static/ exists', fs.existsSync(path.join(standaloneDir, '.next', 'static')));
check('standalone/.next/static/ has JS files',
  countFiles(path.join(standaloneDir, '.next', 'static')) > 0);

// Warning checks (don't fail the run, but indicate issues)
warnCheck('standalone/public/ exists', fs.existsSync(path.join(standaloneDir, 'public')));
warnCheck('standalone/.next/required-server-files.json exists',
  fs.existsSync(path.join(standaloneDir, '.next', 'required-server-files.json')));

// Check that key static asset subfolders are non-empty
const staticDir = path.join(standaloneDir, '.next', 'static');
if (fs.existsSync(staticDir)) {
  for (const sub of fs.readdirSync(staticDir, { withFileTypes: true })) {
    if (sub.isDirectory()) {
      const subPath = path.join(staticDir, sub.name);
      const fileCount = countFiles(subPath);
      if (fileCount === 0) {
        warn('standalone/.next/static/' + sub.name + '/ is empty');
        warnings++;
      } else {
        ok('standalone/.next/static/' + sub.name + '/ contains ' + fileCount + ' files');
      }
    }
  }
}

// Check for the database file (if used)
const dbPath = path.join(standaloneDir, 'bizbook.db');
const prismaClientPath = path.join(standaloneDir, 'node_modules', '@prisma', 'client');
warnCheck('Prisma client is bundled in standalone/', fs.existsSync(prismaClientPath));

// Summary
console.log('');
log('==========================================');
log('Verification complete');
log('  Failures: ' + failures);
log('  Warnings: ' + warnings);
log('==========================================');

if (failures > 0) {
  fail('Critical issues detected. The server may 404 on static assets.');
  fail('Re-run: npm run build (or: bun run build)');
  fail('If the issue persists, run: node scripts/sync-standalone.js');
  process.exit(1);
}

if (warnings > 0) {
  warn('Some non-critical warnings detected. The app will start, but');
  warn('consider running scripts/sync-standalone.js to fix them.');
}

ok('All critical checks passed. Safe to start the server.');
process.exit(0);
