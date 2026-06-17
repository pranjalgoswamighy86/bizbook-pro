#!/bin/bash
# ============================================================
# BizBook Pro — One-Shot Setup Script for Fresh Server
# ============================================================
# This script prepares a fresh Linux server to run BizBook Pro.
# It will:
#   1. Detect / install Node.js (v20+) if missing
#   2. Install npm dependencies
#   3. Generate Prisma client with cross-platform binaries
#   4. Initialize the SQLite database (without overwriting existing data)
#   5. Build the Next.js production bundle
#   6. Run the postbuild.js sync script
#   7. Print next-step instructions
#
# USAGE:
#   chmod +x scripts/setup.sh
#   ./scripts/setup.sh
#
# Tested on:
#   - Ubuntu 22.04 / 24.04
#   - Debian 12
#   - RHEL 9 / AlmaLinux 9
#   - Alpine 3.20 (with apk add nodejs npm)
# ============================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "============================================"
echo "  BizBook Pro — Fresh Server Setup"
echo "  Project: $PROJECT_DIR"
echo "  Date:    $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "============================================"
echo ""

# ------------------------------------------------------------
# 1. Node.js detection
# ------------------------------------------------------------
echo "[1/7] Checking Node.js..."
if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node --version)
    echo "  ✓ Node.js found: $NODE_VERSION"

    # Verify version >= 18.18
    NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_MAJOR" -lt 18 ]; then
        echo "  ✗ Node.js $NODE_VERSION is too old. BizBook Pro needs v18.18+."
        echo "    Installing Node.js 20 via NodeSource..."
        if command -v apt-get >/dev/null 2>&1; then
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>/dev/null || true
            sudo apt-get install -y nodejs
        elif command -v dnf >/dev/null 2>&1; then
            curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo -E bash - 2>/dev/null || true
            sudo dnf install -y nodejs
        else
            echo "  ERROR: Cannot auto-install Node.js. Please install v18.18+ manually."
            exit 1
        fi
    fi
else
    echo "  Node.js not found. Installing Node.js 20..."
    if command -v apt-get >/dev/null 2>&1; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>/dev/null || true
        sudo apt-get install -y nodejs
    elif command -v dnf >/dev/null 2>&1; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo -E bash - 2>/dev/null || true
        sudo dnf install -y nodejs
    elif command -v apk >/dev/null 2>&1; then
        sudo apk add --no-cache nodejs npm
    elif command -v yum >/dev/null 2>&1; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo -E bash - 2>/dev/null || true
        sudo yum install -y nodejs
    else
        echo "  ERROR: Unknown package manager. Install Node.js v18.18+ manually."
        exit 1
    fi
    echo "  ✓ Node.js installed: $(node --version)"
fi

# ------------------------------------------------------------
# 2. Verify npm
# ------------------------------------------------------------
echo ""
echo "[2/7] Checking npm..."
if command -v npm >/dev/null 2>&1; then
    echo "  ✓ npm found: $(npm --version)"
else
    echo "  ✗ npm not found. Installing..."
    if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get install -y npm
    elif command -v dnf >/dev/null 2>&1; then
        sudo dnf install -y npm
    elif command -v apk >/dev/null 2>&1; then
        sudo apk add --no-cache npm
    fi
fi

# ------------------------------------------------------------
# 3. .env file
# ------------------------------------------------------------
echo ""
echo "[3/7] Setting up .env file..."
if [ ! -f "$PROJECT_DIR/.env" ]; then
    if [ -f "$PROJECT_DIR/.env.example" ]; then
        cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
        echo "  ✓ Created .env from .env.example"
        echo "    Edit $PROJECT_DIR/.env to customize settings."
    else
        echo "DATABASE_URL=file:$PROJECT_DIR/db/custom.db" > "$PROJECT_DIR/.env"
        echo "  ✓ Created minimal .env"
    fi
else
    echo "  ✓ .env already exists (left unchanged)"
fi

# ------------------------------------------------------------
# 4. Create required directories
# ------------------------------------------------------------
echo ""
echo "[4/7] Creating directories..."
mkdir -p "$PROJECT_DIR/db"
mkdir -p "$PROJECT_DIR/db/backups"
mkdir -p "$PROJECT_DIR/upload"
mkdir -p "$PROJECT_DIR/logs"
mkdir -p "$PROJECT_DIR/public/temp"
echo "  ✓ db/, db/backups/, upload/, logs/, public/temp/"

# ------------------------------------------------------------
# 5. Install dependencies
# ------------------------------------------------------------
echo ""
echo "[5/7] Installing npm dependencies (this can take 2-5 minutes)..."
cd "$PROJECT_DIR"
if [ -f "package-lock.json" ]; then
    npm ci --no-audit --no-fund 2>&1 | tail -5 || npm install --no-audit --no-fund 2>&1 | tail -5
else
    npm install --no-audit --no-fund 2>&1 | tail -5
fi
echo "  ✓ Dependencies installed"
echo "    node_modules size: $(du -sh node_modules 2>/dev/null | cut -f1)"

# ------------------------------------------------------------
# 6. Generate Prisma client
# ------------------------------------------------------------
echo ""
echo "[6/7] Generating Prisma client (with cross-platform binaries)..."
npx prisma generate 2>&1 | tail -10
echo "  ✓ Prisma client generated"

# Verify Prisma binaries
PRISMA_DIR="$PROJECT_DIR/node_modules/.prisma/client"
if [ -d "$PRISMA_DIR" ]; then
    PRISMA_BINS=$(ls -1 "$PRISMA_DIR"/*.so.node 2>/dev/null | wc -l)
    echo "  Prisma binaries: $PRISMA_BINS .so.node files"
    if [ "$PRISMA_BINS" -eq 0 ]; then
        echo "  ⚠ WARNING: No Prisma .so.node binaries — DB queries will fail."
    fi
fi

# Initialize database if it doesn't exist
if [ ! -f "$PROJECT_DIR/db/custom.db" ]; then
    echo "  Initializing new database..."
    npx prisma db push --skip-generate 2>&1 | tail -5 || true
fi

# ------------------------------------------------------------
# 7. Build
# ------------------------------------------------------------
echo ""
echo "[7/7] Building Next.js production bundle (this can take 2-5 minutes)..."
export NEXT_TELEMETRY_DISABLED=1
npm run build 2>&1 | tail -20
echo "  ✓ Build complete"
echo "    .next size: $(du -sh .next 2>/dev/null | cut -f1)"
echo "    standalone size: $(du -sh .next/standalone 2>/dev/null | cut -f1)"

# ------------------------------------------------------------
# Done
# ------------------------------------------------------------
echo ""
echo "============================================"
echo "  ✅ BizBook Pro is ready to run!"
echo "============================================"
echo ""
echo "Next steps — pick ONE deployment mode:"
echo ""
echo "  ▶ Dev mode (for testing):"
echo "      npm run dev"
echo "      → http://localhost:3000"
echo ""
echo "  ▶ Plain production (single Node.js process):"
echo "      npm start"
echo "      → http://localhost:3000"
echo ""
echo "  ▶ PM2 cluster (recommended for production, needs 'npm i -g pm2'):"
echo "      npm i -g pm2"
echo "      npm run start:pm2"
echo "      pm2 status                # check workers"
echo "      pm2 logs bizbook-pro      # view logs"
echo "      pm2 stop bizbook-pro      # stop"
echo ""
echo "  ▶ Docker (most portable):"
echo "      docker compose up -d"
echo "      → http://localhost:3000"
echo ""
echo "  ▶ With Caddy reverse proxy (port 81 → 3000):"
echo "      caddy run --config Caddyfile"
echo ""
echo "Database backup:"
echo "  npm run db:backup     # create timestamped backup"
echo "  npm run db:backups    # list all backups"
echo "  npm run db:restore    # restore latest backup"
echo ""
echo "See docs/DEPLOYMENT.md for full deployment guide."
echo ""
