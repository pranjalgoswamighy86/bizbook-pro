#!/usr/bin/env node
/**
 * sync-standalone.js — Cross-platform postbuild step that ensures
 * .next/standalone/ contains the public/ folder and .next/static/ assets.
 *
 * Why this exists:
 *   Next.js `output: 'standalone'` produces a minimal server bundle that
 *   does NOT include public/ or .next/static/. Without this sync, the
 *   production server returns 404 for /_next/static/* and any /public
 *   asset (favicon, logo, uploads, etc.), causing broken stylesheets and
 *   missing assets on the external preview URL.
 *
 * Runs as a `postbuild` hook in package.json. No external deps — uses
 * Node.js built-in fs.cpSync (Node 16.7+).
 */

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const standaloneDir = path.join(root, '.next', 'standalone');
const standaloneNextDir = path.join(standaloneDir, '.next');
const staticSrc = path.join(root, '.next', 'static');
const staticDst = path.join(standaloneNextDir, 'static');
const publicSrc = path.join(root, 'public');
const publicDst = path.join(standaloneDir, 'public');

function log(msg) { console.log('[sync-standalone] ' + msg); }
function err(msg) { console.error('[sync-standalone] ERROR: ' + msg); }

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function copyDir(src, dst, label) {
  if (!fs.existsSync(src)) {
    log('Source missing, skipping ' + label + ': ' + src);
    return false;
  }
  ensureDir(path.dirname(dst));
  // Remove destination first to ensure clean state (no stale files)
  if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true, dereference: false });
  const fileCount = countFiles(dst);
  log('Copied ' + label + ': ' + dst + ' (' + fileCount + ' files)');
  return true;
}

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

function main() {
  log('CWD: ' + root);

  if (!fs.existsSync(standaloneDir)) {
    err('Standalone directory not found: ' + standaloneDir);
    err('Did `next build` complete? Did you set output:"standalone" in next.config?');
    process.exit(1);
  }

  let ok = true;

  // 1. Sync .next/static/
  if (!copyDir(staticSrc, staticDst, '.next/static')) {
    err('.next/static is missing — the build may be incomplete.');
    ok = false;
  }

  // 2. Sync public/
  if (!copyDir(publicSrc, publicDst, 'public/')) {
    // public/ is optional but recommended
    log('Warning: no public/ folder found. Creating empty one to avoid 404s.');
    ensureDir(publicDst);
  }

  // 3. Also copy any extra files Next.js standalone misses (e.g. .env, package.json)
  // The standalone already includes a minimal package.json. We don't overwrite.

  // 4. Final verification
  const checks = [
    { path: standaloneDir, label: 'standalone/' },
    { path: path.join(standaloneDir, 'server.js'), label: 'standalone/server.js' },
    { path: staticDst, label: 'standalone/.next/static/' },
    { path: publicDst, label: 'standalone/public/' },
  ];

  log('Verification:');
  let failed = false;
  for (const c of checks) {
    const exists = fs.existsSync(c.path);
    log('  ' + (exists ? 'OK ' : 'FAIL ') + c.label);
    if (!exists) failed = true;
  }

  if (failed) {
    err('Verification failed. The standalone build is incomplete.');
    process.exit(1);
  }

  log('Done. Standalone assets are synced and verified.');
}

try {
  main();
} catch (e) {
  err(e.message);
  err(e.stack);
  process.exit(1);
}
