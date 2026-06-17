#!/bin/bash
# ============================================================
# BizBook Pro — Dev Mode Start
# ============================================================
# Runs Next.js in development mode (hot-reload enabled).
# Slower but easier for debugging.
#
# USAGE:  ./scripts/dev.sh   (or just `npm run dev`)
# ============================================================

set -e
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

if [ ! -f ".env" ]; then
    cp .env.example .env 2>/dev/null || echo "DATABASE_URL=file:./db/custom.db" > .env
    echo "[dev] Created .env from template"
fi

mkdir -p db/backups upload logs

# Generate Prisma client if missing
if [ ! -d "node_modules/.prisma" ]; then
    echo "[dev] Generating Prisma client..."
    npx prisma generate 2>&1 | tail -3
fi

# Push schema if database doesn't exist
if [ ! -f "db/custom.db" ]; then
    echo "[dev] Initializing database..."
    npx prisma db push --skip-generate 2>&1 | tail -3
fi

echo "[dev] Starting Next.js dev server on http://0.0.0.0:3000"
exec npm run dev
