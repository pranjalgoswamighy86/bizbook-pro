import type { NextConfig } from "next";

// ============================================================
// BizBook Pro - Next.js Configuration
// ============================================================
// Server-agnostic configuration. Works on:
//   - Plain Node.js (npm run build && npm start)
//   - PM2 cluster (pm2 start ecosystem.config.js)
//   - Docker (docker compose up -d)
//   - Space-Z platform (use .zscripts/build.sh + start.sh)
//
// `output: "standalone"` produces a self-contained server bundle
// in `.next/standalone/`. The postbuild.js script then copies
// `public/`, `prisma/`, `.env`, and `db/custom.db` into it so the
// resulting directory is fully self-sufficient.
// ============================================================

const nextConfig: NextConfig = {
  output: "standalone",

  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  reactStrictMode: false,

  serverExternalPackages: ["xlsx", "pdf-parse", "mammoth", "imap", "mailparser"],

  // Exclude bloat dirs from the standalone trace so the production
  // bundle stays small. Adjust if you add new top-level dirs.
  outputFileTracingExcludes: {
    "*": [
      "./download/**/*",
      "./skills/**/*",
      "./deployment/**/*",
      "./tool-results/**/*",
      "./upload/**/*",
      "./agent-ctx/**/*",
      "./examples/**/*",
      "./scripts/**/*",
      "./.zscripts/**/*",
      "./.git/**/*",
      "./.next/cache/**/*",
      "./prisma/**/*",
      "./db/backups/**/*",
      "./logs/**/*",
      "./node_modules/.cache/**/*",
      "./**/*.log",
      "./**/*.md",
      "./**/*.zip",
      "./**/*.tar.gz",
      "./**/*.png",
      "./**/*.jpg",
      "./**/*.jpeg",
      "./**/*.gif",
      "./**/*.pdf",
      "./**/*.docx",
      "./**/*.xlsx",
    ],
  },

  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
    optimizePackageImports: ["lucide-react", "recharts", "@radix-ui/react-icons"],
  },

  async headers() {
    return [
      {
        // v4.58: Static assets — cache for 1 year (immutable, hashed filenames)
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        // v4.58: Public assets (logos, icons, manifest) — cache for 1 day
        source: "/:path*.(png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot|js|css)",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
      {
        // v4.58: API — keep-alive + short cache for GET requests
        source: "/api/:path*",
        headers: [
          { key: "Connection", value: "keep-alive" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
