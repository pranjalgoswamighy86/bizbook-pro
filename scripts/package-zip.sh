#!/usr/bin/env bash
# Package BizBook Pro into a distributable ZIP.
# Output: /home/z/my-project/download/BizBook_Pro_Server_v2.zip

set -e

PROJECT_DIR="/home/z/my-project"
STAGING_DIR="/tmp/bizbook-package-$$"
OUTPUT_ZIP="$PROJECT_DIR/download/BizBook_Pro_Server_v2.zip"

mkdir -p "$STAGING_DIR/BizBook_Pro_Server_v2"
cd "$STAGING_DIR/BizBook_Pro_Server_v2"

echo "==> Copying source files..."
cp -r "$PROJECT_DIR/src" .
cp -r "$PROJECT_DIR/public" .
cp -r "$PROJECT_DIR/prisma" .
cp -r "$PROJECT_DIR/scripts" .
cp -r "$PROJECT_DIR/.next/standalone" .next-standalone
mkdir -p .next
cp -r "$PROJECT_DIR/.next/standalone/.next/static" .next/static
cp -r "$PROJECT_DIR/.next/standalone/.next/required-server-files.json" .next/ 2>/dev/null || true

# Copy config files
cp "$PROJECT_DIR/package.json" .
cp "$PROJECT_DIR/package-lock.json" . 2>/dev/null || cp "$PROJECT_DIR/bun.lock" . 2>/dev/null || true
cp "$PROJECT_DIR/next.config.ts" .
cp "$PROJECT_DIR/tsconfig.json" .
cp "$PROJECT_DIR/postcss.config.mjs" .
cp "$PROJECT_DIR/tailwind.config.ts" .
cp "$PROJECT_DIR/components.json" .
cp "$PROJECT_DIR/eslint.config.mjs" .
cp "$PROJECT_DIR/.env" .env
cp "$PROJECT_DIR/.gitignore" .
cp "$PROJECT_DIR/README.md" .
cp "$PROJECT_DIR/START.bat" .
cp "$PROJECT_DIR/start.sh" .
cp "$PROJECT_DIR/Caddyfile" . 2>/dev/null || true

# Ensure .env has a relative DATABASE_URL
cat > .env << 'EOF'
DATABASE_URL="file:./bizbook.db"
EOF

# Include the pre-initialized bizbook.db (empty of data, but with schema)
mkdir -p db
if [ -f "$PROJECT_DIR/bizbook.db" ]; then
  cp "$PROJECT_DIR/bizbook.db" db/bizbook.db
  echo "==> Included pre-initialized db/bizbook.db ($(stat -c%s $PROJECT_DIR/bizbook.db) bytes)"
else
  echo "WARNING: No pre-initialized bizbook.db found. First-run will require prisma CLI."
fi

# Create a node_modules marker — the launcher will install deps on first run
mkdir -p node_modules
cat > node_modules/.placeholder << 'EOF'
This file is a placeholder. Run START.bat / start.sh to install dependencies automatically.
EOF

# Reorganize: place the standalone server at the right path so .next/standalone/server.js works
# IMPORTANT: shopt -s dotglob ensures .next/ (hidden folder) is also copied
set +e
mkdir -p .next/standalone
shopt -s dotglob
cp -r "$PROJECT_DIR/.next/standalone/"* .next/standalone/ 2>&1
shopt -u dotglob
set -e

# Remove the redundant .next-standalone folder
rm -rf .next-standalone

# CRITICAL: Remove any stale empty bizbook.db file that Prisma may have created
# inside the standalone's bundled client dir during build. Otherwise Prisma will
# use that empty DB instead of the real one in the project root.
find .next/standalone/node_modules/.prisma -name "bizbook.db" -type f -delete 2>/dev/null || true
echo "==> Cleaned stale prisma client DB files"

# Verify standalone's internal .next/static/ was copied
if [ ! -d ".next/standalone/.next/static" ]; then
  echo "ERROR: standalone/.next/static is missing after copy!"
  ls -la .next/standalone/
  exit 1
fi
echo "==> standalone/.next/static/ is present ($(ls .next/standalone/.next/static/chunks/ | wc -l) chunks)"

# Add a .zscripts directory placeholder for backward compatibility (used by the platform deployment)
mkdir -p .zscripts

echo "==> File listing:"
ls -la
echo ""
echo "==> .next/standalone/ listing:"
ls -la .next/standalone/ 2>&1 | head -10
echo ""
echo "==> .next/static/ listing:"
ls .next/static/ 2>&1

echo ""
echo "==> Creating ZIP..."
cd "$STAGING_DIR"
rm -f "$OUTPUT_ZIP"
# Exclude top-level node_modules (which only has a placeholder file), but KEEP
# the standalone's bundled node_modules (under .next/standalone/node_modules/)
# since that's what makes the standalone server actually run.
zip -rq "$OUTPUT_ZIP" BizBook_Pro_Server_v2 \
  -x "BizBook_Pro_Server_v2/node_modules/*" \
  -x "*/.git/*"

echo "==> Done!"
ls -lah "$OUTPUT_ZIP"
echo ""
echo "==> ZIP contents (first 30 entries):"
unzip -l "$OUTPUT_ZIP" | head -40

# Clean up
rm -rf "$STAGING_DIR"
