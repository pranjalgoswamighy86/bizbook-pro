# ============================================================
# BizBook Pro — Dockerfile (v4.56)
# ============================================================
# This Dockerfile REPLACES nixpacks.toml to ensure the build
# always uses PostgreSQL (no SQLite cache issues).
# ============================================================

FROM node:20-slim

# Install OpenSSL + PostgreSQL client (for psql if needed)
RUN apt-get update && apt-get install -y openssl libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install --no-audit --no-fund

# Copy source code
COPY . .

# Generate Prisma client (uses schema.prisma which now has provider = "postgresql")
RUN npx prisma generate

# Build Next.js (v4.56.2: removed --webpack flag — causes standalone build issues)
RUN NODE_OPTIONS="--max-old-space-size=2048" npx next build

# Run postbuild (copies files to standalone)
RUN node postbuild.js

# Expose port
EXPOSE 8080

# Start command
CMD ["node", "scripts/railway-start.js"]
