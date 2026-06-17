#!/bin/bash
# ============================================================
# BizBook Pro — Start Script (Plain Node.js Production)
# ============================================================
# Starts the standalone Next.js server from .next/standalone/server.js
#
# USAGE:
#   chmod +x scripts/start.sh
#   ./scripts/start.sh
#
# Or via npm:
#   npm start
# ============================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# Load .env
if [ -f ".env" ]; then
    export $(grep -v '^#' .env | xargs) 2>/dev/null || true
fi

# Defaults
export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export DATABASE_URL="${DATABASE_URL:-file:$PROJECT_DIR/db/custom.db}"
export UV_THREADPOOL_SIZE="${UV_THREADPOOL_SIZE:-32}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=768}"

# Ensure directories exist
mkdir -p "$PROJECT_DIR/db"
mkdir -p "$PROJECT_DIR/db/backups"
mkdir -p "$PROJECT_DIR/upload"
mkdir -p "$PROJECT_DIR/logs"

# Verify build exists
if [ ! -f ".next/standalone/server.js" ]; then
    echo "ERROR: .next/standalone/server.js not found."
    echo "Run 'npm run build' first, or './scripts/setup.sh' for full setup."
    exit 1
fi

echo "============================================"
echo "  BizBook Pro — Starting"
echo "  Port:     $PORT"
echo "  Hostname: $HOSTNAME"
echo "  DB:       $DATABASE_URL"
echo "  Mode:     $NODE_ENV"
echo "============================================"

# Write .env into standalone dir so server.js picks it up
echo "DATABASE_URL=$DATABASE_URL" > .next/standalone/.env

# Make sure static/public/prisma are synced into standalone
# (postbuild.js does this during build, but re-run as safety net)
if [ -f "postbuild.js" ] && [ -d ".next" ]; then
    node postbuild.js 2>&1 | tail -5 || true
fi

cd .next/standalone
exec node server.js
