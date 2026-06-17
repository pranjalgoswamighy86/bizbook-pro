#!/bin/bash
# ============================================================
# BizBook Pro — Build Script (Generic, Server-Agnostic)
# ============================================================
# Builds the production bundle. Works on any Linux server.
# Not tied to Space-Z platform.
#
# USAGE:  ./scripts/build.sh
# ============================================================

set -e
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

export NEXT_TELEMETRY_DISABLED=1

echo "============================================"
echo "  BizBook Pro — Building Production Bundle"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "============================================"

# Step 1: install deps if missing
if [ ! -d "node_modules" ]; then
    echo "[1/4] Installing dependencies..."
    if [ -f "package-lock.json" ]; then
        npm ci --no-audit --no-fund 2>&1 | tail -3
    else
        npm install --no-audit --no-fund 2>&1 | tail -3
    fi
else
    echo "[1/4] Dependencies already installed"
fi

# Step 2: Prisma generate
echo ""
echo "[2/4] Generating Prisma client..."
npx prisma generate 2>&1 | tail -3

# Step 3: Build
echo ""
echo "[3/4] Building Next.js..."
npm run build 2>&1 | tail -20

# Step 4: Verify
echo ""
echo "[4/4] Verifying build..."
if [ -f ".next/standalone/server.js" ]; then
    echo "  ✓ server.js present"
else
    echo "  ✗ server.js MISSING — build failed"
    exit 1
fi
if [ -d ".next/standalone/.next/static" ]; then
    echo "  ✓ static files present"
else
    echo "  ✗ static files MISSING"
    exit 1
fi
if [ -d ".next/standalone/public" ]; then
    echo "  ✓ public dir present"
else
    echo "  ✗ public dir MISSING"
    exit 1
fi
if [ -d ".next/standalone/node_modules/.prisma" ]; then
    echo "  ✓ Prisma client present"
else
    echo "  ⚠ Prisma client not in standalone — may fail at runtime"
fi

echo ""
echo "============================================"
echo "  ✅ Build complete!"
echo "  Standalone size: $(du -sh .next/standalone | cut -f1)"
echo "============================================"
echo ""
echo "Start the server with:"
echo "  ./scripts/start.sh"
echo "  or"
echo "  npm start"
echo "  or"
echo "  pm2 start ecosystem.config.js   (cluster mode)"
