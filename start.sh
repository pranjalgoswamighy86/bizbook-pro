#!/usr/bin/env bash
# BizBook Pro — Linux/macOS launcher
# Run this script to start BizBook Pro on any machine with Node.js installed.
# Usage:  ./start.sh
# Then open http://localhost:3000 in your browser.

set -e

# Get script directory (where this file lives)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "  BizBook Pro v2.0 — Starting"
echo "============================================"
echo ""

# ---- 1. Check Node.js ----
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not installed."
  echo "Please install Node.js 18 or newer from https://nodejs.org and try again."
  read -p "Press Enter to exit..."
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "ERROR: Node.js 18+ is required. You have $(node -v)."
  echo "Please upgrade at https://nodejs.org"
  read -p "Press Enter to exit..."
  exit 1
fi
echo "[1/3] Node.js OK ($(node -v))"

# ---- 2. Ensure bizbook.db exists ----
if [ ! -f "bizbook.db" ]; then
  if [ -f "db/bizbook.db" ]; then
    cp db/bizbook.db bizbook.db
  else
    echo "[2/3] Database not found. Creating empty database..."
    # Try using bundled prisma; fall back to standalone client
    if [ -d "node_modules/prisma" ]; then
      DATABASE_URL="file:./bizbook.db" node node_modules/prisma/build/index.js db push --skip-generate 2>/dev/null || true
    elif [ -d ".next/standalone/node_modules/.prisma" ]; then
      # Use the bundled prisma engine inside standalone
      DATABASE_URL="file:./bizbook.db" node .next/standalone/node_modules/prisma/build/index.js db push --skip-generate 2>/dev/null || true
    fi
    # If still no db, create a placeholder and let the app crash with a clear error
    if [ ! -f "bizbook.db" ]; then
      echo "ERROR: Could not initialize database. Please run 'npm install && npx prisma db push' manually."
      exit 1
    fi
  fi
  echo "[2/3] Database created at ./bizbook.db"
else
  echo "[2/3] Database OK (./bizbook.db)"
fi

# ---- 3. Verify build, then start server ----
echo "[3/3] Verifying build..."
if [ ! -d ".next/standalone" ]; then
  echo "Build not found. Running production build..."
  echo "This requires npm install (first run only, may take a few minutes)..."
  if ! command -v npm >/dev/null 2>&1; then
    echo "ERROR: npm not found. Please install Node.js from https://nodejs.org"
    exit 1
  fi
  npm install
  npm run build
fi

# Run verification
node scripts/verify-standalone.js || {
  echo ""
  echo "ERROR: Build verification failed. Attempting rebuild..."
  npm install
  npm run build
  node scripts/verify-standalone.js || {
    echo "ERROR: Verification still failing. Please contact support."
    exit 1
  }
}

echo ""
echo "============================================"
echo "  BizBook Pro is running!"
echo "============================================"
echo ""
echo "  Local:   http://localhost:3000"
echo ""
HOST_IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "")
if [ -n "$HOST_IP" ]; then
  echo "  Network: http://$HOST_IP:3000  (other devices on same WiFi/LAN)"
fi
echo ""
echo "  Press Ctrl+C to stop the server."
echo "  Your data is stored in ./bizbook.db (SQLite)."
echo "  Back up this file to keep your data safe."
echo ""
echo "============================================"
echo ""

# Set production env
# IMPORTANT: Use absolute path for DATABASE_URL so Prisma always finds the DB
# in the project root, not in some bundled node_modules/.prisma/client/ dir.
export NODE_ENV=production
export DATABASE_URL="file:$SCRIPT_DIR/bizbook.db"
export PORT=3000
export HOSTNAME=0.0.0.0

# Start the server
exec node .next/standalone/server.js
