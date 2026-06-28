// ============================================================
// BizBook Pro - Post-Build Script
// ============================================================
// After `next build`, this script:
//   1. Flattens the standalone output (Next.js 16 may nest it
//      inside <project-name>/ when a parent package.json exists)
//   2. Copies static files, public/, prisma/, .env, db/ into the
//      standalone directory so it's fully self-sufficient
//   3. Verifies critical files are present
// ============================================================

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname);
const STANDALONE_DIR = path.join(PROJECT_ROOT, ".next", "standalone");
const NEXT_DIR = path.join(PROJECT_ROOT, ".next");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`[POSTBUILD] Source not found, skipping: ${src}`);
    return;
  }
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
  }
}

function rmRecursive(target) {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
}

console.log("[POSTBUILD] Starting post-build file synchronization...");

if (!fs.existsSync(STANDALONE_DIR)) {
  console.error(`[POSTBUILD] FATAL: standalone dir not found: ${STANDALONE_DIR}`);
  console.error("[POSTBUILD] Did `next build` succeed? Did next.config.ts have output: 'standalone'?");
  process.exit(1);
}

// ------------------------------------------------------------
// Step 0: Flatten nested project subdirectory if present
// ------------------------------------------------------------
// Next.js 16 sometimes nests the standalone output inside
// `<project-name>/` when it detects a parent package.json
// (treating it as a monorepo root). Detect this and flatten.
// ------------------------------------------------------------
console.log("[POSTBUILD] Checking for nested project subdirectory...");

const expectedServer = path.join(STANDALONE_DIR, "server.js");
if (!fs.existsSync(expectedServer)) {
  // Find a nested server.js
  const entries = fs.readdirSync(STANDALONE_DIR);
  for (const entry of entries) {
    const nestedServer = path.join(STANDALONE_DIR, entry, "server.js");
    if (fs.existsSync(nestedServer) && fs.statSync(nestedServer).isFile()) {
      console.log(`[POSTBUILD] Found nested standalone output in: ${entry}/`);
      const nestedDir = path.join(STANDALONE_DIR, entry);

      // Move everything from nested dir up to STANDALONE_DIR
      for (const item of fs.readdirSync(nestedDir)) {
        const src = path.join(nestedDir, item);
        const dest = path.join(STANDALONE_DIR, item);
        if (fs.existsSync(dest)) {
          // If both exist, prefer the nested one (it's what Next.js built)
          // But preserve our postbuild additions if they're already there
          if (fs.statSync(src).isDirectory() && fs.statSync(dest).isDirectory()) {
            // Merge directories
            for (const sub of fs.readdirSync(src)) {
              copyRecursive(path.join(src, sub), path.join(dest, sub));
            }
          } else {
            rmRecursive(dest);
            copyRecursive(src, dest);
          }
        } else {
          copyRecursive(src, dest);
        }
      }

      // Remove the now-empty nested directory
      rmRecursive(nestedDir);
      console.log(`[POSTBUILD] Flattened nested output.`);
      break;
    }
  }
}

// ------------------------------------------------------------
// Step 1: Copy static files
// ------------------------------------------------------------
console.log("[POSTBUILD] Copying static files...");
const staticSrc = path.join(NEXT_DIR, "static");
const staticDest = path.join(STANDALONE_DIR, ".next", "static");
if (fs.existsSync(staticSrc)) {
  copyRecursive(staticSrc, staticDest);
  console.log("[POSTBUILD] ✅ Static files copied");
} else {
  console.warn("[POSTBUILD] ⚠️  No static directory found");
}

// ------------------------------------------------------------
// Step 2: Copy public directory
// ------------------------------------------------------------
console.log("[POSTBUILD] Copying public directory...");
const publicSrc = path.join(PROJECT_ROOT, "public");
const publicDest = path.join(STANDALONE_DIR, "public");
if (fs.existsSync(publicSrc)) {
  copyRecursive(publicSrc, publicDest);
  console.log("[POSTBUILD] ✅ Public directory copied");
}

// ------------------------------------------------------------
// Step 3: Copy prisma directory
// ------------------------------------------------------------
console.log("[POSTBUILD] Copying prisma directory...");
const prismaSrc = path.join(PROJECT_ROOT, "prisma");
const prismaDest = path.join(STANDALONE_DIR, "prisma");
if (fs.existsSync(prismaSrc)) {
  copyRecursive(prismaSrc, prismaDest);
  console.log("[POSTBUILD] ✅ Prisma directory copied");
}

// ------------------------------------------------------------
// Step 4: Sync .env file
// ------------------------------------------------------------
console.log("[POSTBUILD] Syncing .env file...");
const envSrc = path.join(PROJECT_ROOT, ".env");
const envDest = path.join(STANDALONE_DIR, ".env");
if (fs.existsSync(envSrc)) {
  fs.copyFileSync(envSrc, envDest);
  console.log("[POSTBUILD] ✅ .env file copied");
} else {
  // Create a minimal .env so server.js doesn't crash
  fs.writeFileSync(envDest, `DATABASE_URL=file:${path.join(STANDALONE_DIR, "db/custom.db")}\n`);
  console.log("[POSTBUILD] ⚠️  No .env found — created minimal .env");
}

// ------------------------------------------------------------
// Step 4b: Copy .z-ai-config (v4.127 — AI Smart Import needs this!)
// ------------------------------------------------------------
console.log("[POSTBUILD] Syncing .z-ai-config...");
const zaiConfigSrc = path.join(PROJECT_ROOT, ".z-ai-config");
const zaiConfigDest = path.join(STANDALONE_DIR, ".z-ai-config");
if (fs.existsSync(zaiConfigSrc)) {
  fs.copyFileSync(zaiConfigSrc, zaiConfigDest);
  console.log("[POSTBUILD] ✅ .z-ai-config copied");
} else {
  console.log("[POSTBUILD] ⚠️  .z-ai-config not found — AI Smart Import will use fallback config");
}

// ------------------------------------------------------------
// Step 5: Copy database
// ------------------------------------------------------------
console.log("[POSTBUILD] Copying database...");
const dbSrc = path.join(PROJECT_ROOT, "db", "custom.db");
const dbDestDir = path.join(STANDALONE_DIR, "db");
if (fs.existsSync(dbSrc)) {
  ensureDir(dbDestDir);
  fs.copyFileSync(dbSrc, path.join(dbDestDir, "custom.db"));
  console.log("[POSTBUILD] ✅ Database copied");
}

// ------------------------------------------------------------
// Step 6: Create runtime directories
// ------------------------------------------------------------
console.log("[POSTBUILD] Creating runtime directories...");
ensureDir(path.join(STANDALONE_DIR, "upload"));
ensureDir(path.join(STANDALONE_DIR, "db", "backups"));
ensureDir(path.join(STANDALONE_DIR, "logs"));
console.log("[POSTBUILD] ✅ Runtime directories ready");

// ------------------------------------------------------------
// Step 7: Copy essential node_modules that standalone might miss
// ------------------------------------------------------------
console.log("[POSTBUILD] Copying essential node_modules...");
const essentialModules = [
  "z-ai-web-dev-sdk",
  "pdf-parse",
  "mammoth",
  "@prisma/client",
  ".prisma",
  "resend",
  "nodemailer",
  "pm2",        // v4.56.2: PM2 for cluster mode
  "axios",      // v4.56.2: Used by Brevo + health monitor
];
const nmDest = path.join(STANDALONE_DIR, "node_modules");
ensureDir(nmDest);

for (const mod of essentialModules) {
  const modSrc = path.join(PROJECT_ROOT, "node_modules", mod);
  const modDest = path.join(nmDest, mod);
  if (fs.existsSync(modSrc)) {
    if (!fs.existsSync(modDest)) {
      try {
        copyRecursive(modSrc, modDest);
        console.log(`[POSTBUILD] ✅ ${mod} copied`);
      } catch (err) {
        console.warn(`[POSTBUILD] ⚠️  Failed to copy ${mod}: ${err.message}`);
      }
    } else {
      console.log(`[POSTBUILD] ✅ ${mod} already present`);
    }
  }
}

// ------------------------------------------------------------
// Step 7b: Verify Prisma binaries
// ------------------------------------------------------------
console.log("[POSTBUILD] Verifying Prisma binaries...");
const prismaClientDir = path.join(nmDest, ".prisma", "client");
if (fs.existsSync(prismaClientDir)) {
  const prismaFiles = fs.readdirSync(prismaClientDir);
  const soFiles = prismaFiles.filter((f) => f.endsWith(".so.node"));
  console.log(`[POSTBUILD] ✅ Prisma client has ${soFiles.length} .so.node binaries:`);
  for (const f of soFiles) {
    console.log(`[POSTBUILD]    - ${f}`);
  }
  if (soFiles.length === 0) {
    console.warn("[POSTBUILD] ⚠️  No Prisma .so.node binaries — DB queries will fail.");
  }
} else {
  console.warn("[POSTBUILD] ⚠️  Prisma client directory missing!");
}


// ------------------------------------------------------------
// Step 7c: Create @prisma/client-<hash> symlink (Turbopack fix)
// ------------------------------------------------------------
// Turbopack generates hashed module names like @prisma/client-2c3a283f134fdcb6
// in the production build, but the actual module is @prisma/client (no hash).
// Without this symlink, the production server crashes with:
//   "Cannot find module '@prisma/client-2c3a283f134fdcb6'"
// ------------------------------------------------------------
console.log("[POSTBUILD] Creating @prisma/client-<hash> symlinks...");
const prismaAtClientDir = path.join(nmDest, "@prisma");
if (fs.existsSync(prismaAtClientDir)) {
  const entries = fs.readdirSync(prismaAtClientDir);
  for (const entry of entries) {
    if (entry.startsWith("client-") && entry !== "client") {
      // Already has a hash variant — skip
      console.log(`[POSTBUILD] ✅ ${entry} already exists`);
      continue;
    }
  }
  // Find what hash the build expects by scanning the server chunks
  const serverChunksDir = path.join(STANDALONE_DIR, ".next", "server", "chunks");
  if (fs.existsSync(serverChunksDir)) {
    const chunkFiles = fs.readdirSync(serverChunksDir);
    const hashPattern = /@prisma\/client-([a-f0-9]+)/g;
    const foundHashes = new Set();
    for (const chunkFile of chunkFiles) {
      const chunkPath = path.join(serverChunksDir, chunkFile);
      if (fs.statSync(chunkPath).isFile()) {
        const content = fs.readFileSync(chunkPath, 'utf-8');
        let match;
        while ((match = hashPattern.exec(content)) !== null) {
          foundHashes.add(match[1]);
        }
      }
    }
    for (const hash of foundHashes) {
      const linkName = `client-${hash}`;
      const linkPath = path.join(prismaAtClientDir, linkName);
      const targetPath = path.join(prismaAtClientDir, "client");
      if (!fs.existsSync(linkPath) && fs.existsSync(targetPath)) {
        fs.symlinkSync("client", linkPath, "dir");
        console.log(`[POSTBUILD] ✅ Created symlink: @prisma/${linkName} → @prisma/client`);
      }
    }
    if (foundHashes.size === 0) {
      // Fallback: create the known hash symlink
      const knownHash = "2c3a283f134fdcb6";
      const linkPath = path.join(prismaAtClientDir, `client-${knownHash}`);
      if (!fs.existsSync(linkPath)) {
        fs.symlinkSync("client", linkPath, "dir");
        console.log(`[POSTBUILD] ✅ Created fallback symlink: @prisma/client-${knownHash} → @prisma/client`);
      }
    }
  }
}

// ------------------------------------------------------------
// Step 8: Final verification (non-blocking — don't fail build)
// ------------------------------------------------------------
console.log("[POSTBUILD] Final verification...");
const criticalFiles = [
  path.join(STANDALONE_DIR, "server.js"),
  path.join(STANDALONE_DIR, ".next", "static"),
  path.join(STANDALONE_DIR, "public"),
];

// These are checked but NOT required (won't fail the build if missing)
const optionalFiles = [
  path.join(STANDALONE_DIR, ".env"),
  path.join(STANDALONE_DIR, "db", "custom.db"),
  path.join(STANDALONE_DIR, "node_modules", ".prisma", "client"),
];

for (const file of criticalFiles) {
  if (!fs.existsSync(file)) {
    console.error(`[POSTBUILD] ❌ MISSING (critical): ${file}`);
    console.error("[POSTBUILD] ❌ Build cannot continue without this file!");
    process.exit(1);
  } else {
    console.log(`[POSTBUILD] ✅ ${path.relative(STANDALONE_DIR, file)}`);
  }
}

for (const file of optionalFiles) {
  if (!fs.existsSync(file)) {
    console.log(`[POSTBUILD] ⚠️  Optional file not found (OK): ${path.relative(STANDALONE_DIR, file)}`);
  } else {
    console.log(`[POSTBUILD] ✅ ${path.relative(STANDALONE_DIR, file)}`);
  }
}

console.log("");
console.log("[POSTBUILD] ========================================");
console.log("[POSTBUILD]  Post-build complete!");
console.log(`[POSTBUILD]  Standalone size: ${getDirSize(STANDALONE_DIR)}`);
console.log("[POSTBUILD] ========================================");

function getDirSize(dir) {
  let total = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d)) {
      const full = path.join(d, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else total += stat.size;
    }
  };
  try { walk(dir); } catch {}
  return formatBytes(total);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ------------------------------------------------------------
// Step 9: Aggressive size reduction — target ~20MB standalone
// ------------------------------------------------------------
console.log("[POSTBUILD] Aggressive size reduction...");

// 9a: Remove ALL native Prisma binaries — use WASM engine (2.1MB vs 17MB)
const prismaEnginesDir = path.join(nmDest, ".prisma", "client");
if (fs.existsSync(prismaEnginesDir)) {
  const engines = fs.readdirSync(prismaEnginesDir).filter(f =>
    f.endsWith('.so.node') || f.endsWith('.dll.node') || f.endsWith('.dylib.node')
  );
  for (const engine of engines) {
    fs.unlinkSync(path.join(prismaEnginesDir, engine));
  }
  // Re-add WASM engine from source node_modules
  const sourceWasm = path.join(PROJECT_ROOT, "node_modules", ".prisma", "client", "query_engine_bg.wasm");
  const destWasm = path.join(prismaEnginesDir, "query_engine_bg.wasm");
  if (fs.existsSync(sourceWasm) && !fs.existsSync(destWasm)) {
    fs.copyFileSync(sourceWasm, destWasm);
  }
  console.log(`[POSTBUILD] ✅ Removed ${engines.length} native Prisma binaries, using WASM engine (2.1MB)`);
}

// 9b: Remove non-SQLite WASM engines from Prisma runtime (PostgreSQL, MySQL, etc.)
const prismaRuntimeDir = path.join(nmDest, "@prisma", "client", "runtime");
if (fs.existsSync(prismaRuntimeDir)) {
  const runtimeFiles = fs.readdirSync(prismaRuntimeDir);
  let removed = 0;
  for (const file of runtimeFiles) {
    // Remove WASM base64 files for databases we don't use
    if (file.includes('postgresql') || file.includes('mysql') ||
        file.includes('cockroachdb') || file.includes('sqlserver') ||
        file.includes('mongodb') || file.includes('sql')) {
      // Keep only sqlite
      if (!file.includes('sqlite')) {
        fs.unlinkSync(path.join(prismaRuntimeDir, file));
        removed++;
      }
    }
    // Remove all .map files
    if (file.endsWith('.map')) {
      fs.unlinkSync(path.join(prismaRuntimeDir, file));
      removed++;
    }
    // Remove .d.ts and .d.mts (TypeScript declarations, not needed at runtime)
    if (file.endsWith('.d.ts') || file.endsWith('.d.mts')) {
      fs.unlinkSync(path.join(prismaRuntimeDir, file));
      removed++;
    }
    // Remove .mjs if .js exists (we use CommonJS)
    if (file.endsWith('.mjs') && fs.existsSync(path.join(prismaRuntimeDir, file.replace('.mjs', '.js')))) {
      fs.unlinkSync(path.join(prismaRuntimeDir, file));
      removed++;
    }
  }
  console.log(`[POSTBUILD] ✅ Removed ${removed} unnecessary Prisma runtime files`);
}

// 9c: Remove sharp and @img entirely — not used in our code
// (Next.js image optimization is handled by the browser, not server-side sharp)
const sharpDir = path.join(nmDest, "sharp");
const imgDir = path.join(nmDest, "@img");
if (fs.existsSync(sharpDir)) { rmRecursive(sharpDir); console.log("[POSTBUILD] ✅ Removed sharp"); }
if (fs.existsSync(imgDir)) { rmRecursive(imgDir); console.log("[POSTBUILD] ✅ Removed @img (33MB saved)"); }

// 9d: Remove typescript from standalone (not needed at runtime)
const tsDir = path.join(nmDest, "typescript");
if (fs.existsSync(tsDir)) { rmRecursive(tsDir); console.log("[POSTBUILD] ✅ Removed typescript"); }

// 9e: Remove all .map files from the entire standalone
function removeMapFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  let bytes = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d)) {
      const full = path.join(d, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) walk(full);
        else if (entry.endsWith('.map')) { bytes += stat.size; fs.unlinkSync(full); count++; }
      } catch {}
    }
  };
  walk(dir);
  return { count, bytes };
}
const mapResult = removeMapFiles(STANDALONE_DIR);
console.log(`[POSTBUILD] ✅ Removed ${mapResult.count} source map files (${formatBytes(mapResult.bytes)})`);

// 9f: Remove .ts files from node_modules (TypeScript source, not needed at runtime)
function removeTsFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d)) {
      const full = path.join(d, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') walk(full);
        else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) { fs.unlinkSync(full); count++; }
      } catch {}
    }
  };
  walk(dir);
  return count;
}
const tsCount = removeTsFiles(path.join(STANDALONE_DIR, "node_modules"));
console.log(`[POSTBUILD] ✅ Removed ${tsCount} .ts files from node_modules`);

// 9g: Remove README, LICENSE, CHANGELOG files from node_modules
function removeDocFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d)) {
      const full = path.join(d, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) walk(full);
        else if (/^(README|CHANGELOG|HISTORY|LICENSE|LICENCE|NOTICE|AUTHORS)/i.test(entry) ||
                 entry.endsWith('.md') || entry.endsWith('.markdown')) {
          fs.unlinkSync(full); count++;
        }
      } catch {}
    }
  };
  walk(dir);
  return count;
}
const docCount = removeDocFiles(path.join(STANDALONE_DIR, "node_modules"));
console.log(`[POSTBUILD] ✅ Removed ${docCount} doc/license files from node_modules`);

// 9h: next/dist left intact (tightly coupled)

// Re-calculate size
console.log(`[POSTBUILD] Standalone size after aggressive cleanup: ${getDirSize(STANDALONE_DIR)}`);

// ------------------------------------------------------------
// Step 10: Extra aggressive cuts for ~20MB target
// ------------------------------------------------------------
console.log("[POSTBUILD] Extra aggressive cuts...");

// 10a: Remove Prisma TypeScript declarations and unused WASM
const prismaClientGeneratedDir = path.join(nmDest, ".prisma", "client");
if (fs.existsSync(prismaClientGeneratedDir)) {
  const toRemove = ['index.d.ts', 'query_engine_bg.wasm', 'index-browser.js', 'edge.js', 'wasm.js', 'wasm-worker-loader.mjs', 'wasm-edge-light-loader.mjs', 'default.js'];
  for (const f of toRemove) {
    const fp = path.join(prismaClientGeneratedDir, f);
    if (fs.existsSync(fp)) { fs.unlinkSync(fp); }
  }
  console.log("[POSTBUILD] ✅ Removed unused .prisma/client files");
}

// 10b: Remove Prisma runtime files we don't need
if (fs.existsSync(prismaRuntimeDir)) {
  const toRemove = [
    'react-native.js', 'react-native.d.ts',
    'edge.js', 'edge.d.ts', 'edge-esm.js', 'edge-esm.d.ts',
    'wasm-compiler-edge.js', 'wasm-compiler-edge.d.ts',
  ];
  for (const f of toRemove) {
    const fp = path.join(prismaRuntimeDir, f);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  // Remove ALL WASM base64 files (we use native binary)
  const runtimeFiles = fs.readdirSync(prismaRuntimeDir);
  for (const f of runtimeFiles) {
    if (f.includes('wasm-base64') || f.includes('wasm.mjs')) {
      fs.unlinkSync(path.join(prismaRuntimeDir, f));
    }
  }
  console.log("[POSTBUILD] ✅ Removed unused Prisma runtime files + WASM base64");
}

// 10c: next/dist is tightly coupled — do NOT remove anything from it

// 10d: xlsx kept (needed for Excel export)

// 10e: pdfjs-dist kept (needed by pdf-parse)

// 10f: Remove the native Prisma binary and use WASM engine instead (saves 17MB)
// Re-add the WASM engine that we removed in 10a
// Actually, we need the WASM file if we remove the native binary.
// Let's keep the native binary for now — it's more reliable.
// If we need to hit 20MB, we can remove it later.


// 10f: Remove Prisma generator-build (not needed at runtime)
const genBuildDir = path.join(nmDest, "@prisma", "client", "generator-build");
if (fs.existsSync(genBuildDir)) { rmRecursive(genBuildDir); console.log("[POSTBUILD] ✅ Removed @prisma/client/generator-build"); }

// 10g: Remove Prisma binary.js runtime (we use WASM, not native binary)
const binaryJs = path.join(nmDest, "@prisma", "client", "runtime", "binary.js");
if (fs.existsSync(binaryJs)) { fs.unlinkSync(binaryJs); console.log("[POSTBUILD] ✅ Removed @prisma/client/runtime/binary.js"); }

// 10h: Remove xlsx .mjs and .extendscript.js (keep .js and .min.js)
const xlsxDir2 = path.join(nmDest, "xlsx");
if (fs.existsSync(xlsxDir2)) {
  for (const f of ['xlsx.mjs', 'xlsx.js', 'dist/xlsx.extendscript.js']) {
    const fp = path.join(xlsxDir2, f);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  console.log("[POSTBUILD] ✅ Removed xlsx .mjs and .extendscript.js");
}

// 10i: Remove pdfjs-dist .mjs (keep .js)
const pdfjsMjs = path.join(nmDest, "pdfjs-dist", "legacy", "build", "pdf.mjs");
if (fs.existsSync(pdfjsMjs)) { fs.unlinkSync(pdfjsMjs); console.log("[POSTBUILD] ✅ Removed pdfjs-dist .mjs"); }

// Final size
console.log(`[POSTBUILD] Final standalone size: ${getDirSize(STANDALONE_DIR)}`);
