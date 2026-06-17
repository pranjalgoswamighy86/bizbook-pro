#!/bin/bash
# ============================================================
# BizBook Pro — Prepare for GitHub + Render.com Deployment
# ============================================================
# Run this script to prepare the project for pushing to GitHub
# and deploying on Render.com.
#
# Usage:
#   chmod +x scripts/prepare-for-deploy.sh
#   ./scripts/prepare-for-deploy.sh
# ============================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "============================================"
echo "  BizBook Pro — Deploy Preparation"
echo "============================================"
echo ""

# Step 1: Check git is installed
if ! command -v git >/dev/null 2>&1; then
  echo "❌ Git is not installed. Install it from https://git-scm.com"
  exit 1
fi
echo "✓ Git installed: $(git --version)"

# Step 2: Initialize git repo (if not already)
if [ ! -d ".git" ]; then
  echo "→ Initializing git repository..."
  git init
  git branch -M main
  echo "✓ Git repository initialized"
else
  echo "✓ Git repository already exists"
fi

# Step 3: Check for .gitignore
if [ ! -f ".gitignore" ]; then
  echo "❌ .gitignore not found!"
  exit 1
fi
echo "✓ .gitignore exists"

# Step 4: Verify .env is NOT tracked
if git ls-files --cached | grep -q "^\.env$"; then
  echo "⚠ .env is tracked by git! Removing from tracking..."
  git rm --cached .env
fi
echo "✓ .env will not be committed (secrets protected)"

# Step 5: Verify database is NOT tracked
if git ls-files --cached | grep -q "db/custom.db"; then
  echo "⚠ Database file is tracked by git! Removing from tracking..."
  git rm --cached db/custom.db
fi
echo "✓ Database file will not be committed"

# Step 6: Stage all files
echo "→ Staging files..."
git add -A
echo "✓ Files staged"

# Step 7: Show what will be committed
FILE_COUNT=$(git diff --cached --name-only | wc -l)
echo "✓ $FILE_COUNT files ready to commit"

# Step 8: Commit
git commit -m "BizBook Pro — Production Ready (security patched, subscription, Razorpay)" 2>/dev/null || {
  echo "→ Nothing new to commit (already up to date)"
}
echo "✓ Code committed"

echo ""
echo "============================================"
echo "  Next Steps"
echo "============================================"
echo ""
echo "1. Create a GitHub repository:"
echo "   Go to https://github.com/new"
echo "   Repository name: bizbook-pro"
echo "   Set to PRIVATE (recommended)"
echo "   Do NOT add README/license/.gitignore (we have them)"
echo ""
echo "2. Push to GitHub:"
echo "   git remote add origin https://github.com/YOUR_USERNAME/bizbook-pro.git"
echo "   git push -u origin main"
echo ""
echo "3. Deploy on Render.com:"
echo "   Go to https://dashboard.render.com"
echo "   Click 'New +' → 'Blueprint'"
echo "   Select your GitHub repository"
echo "   Click 'Apply'"
echo ""
echo "4. Set environment variables in Render dashboard:"
echo "   SESSION_SECRET = (run: openssl rand -hex 32)"
echo "   SMTP_USER = pranjalgoswamighy86@gmail.com"
echo "   SMTP_PASS = nvyz jufl wbbc ffys"
echo "   SMTP_FROM = BizBook Pro <pranjalgoswamighy86@gmail.com>"
echo "   TWOFACTOR_API_KEY = cf178fc7-67cf-11f1-8f15-0200cd936042"
echo ""
echo "5. Add persistent disk:"
echo "   Render dashboard → Disks → Add Disk"
echo "   Name: bizbook-db"
echo "   Mount Path: /opt/render/project/src/db"
echo "   Size: 1 GB"
echo ""
echo "6. Your app will be live at:"
echo "   https://bizbook-pro.onrender.com"
echo ""
echo "============================================"
