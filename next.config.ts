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

  // v6.20.0: Suppress X-Powered-By header (was leaking "Next.js" to attackers)
  poweredByHeader: false,

  typescript: {
    ignoreBuildErrors: true,
  },
  // v6.21.0: Removed deprecated `eslint: { ignoreDuringBuilds: true }` key
  // Next.js 16 no longer recognizes this key — it was producing build warnings:
  //   ⚠ `eslint` configuration in next.config.ts is no longer supported.
  //   ⚠ Invalid next.config.ts options detected: Unrecognized key(s) in object: 'eslint'
  // ESLint is now configured via .eslintrc (if present) or skipped entirely.
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
    // v6.20.0: Security headers applied to ALL routes (OWASP ASVS V14.1 compliance)
    // Resolves audit findings P1-1: 7 missing security headers + X-Powered-By leak
    const securityHeaders = [
      // Force HTTPS for 1 year, include subdomains, request preload list inclusion
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
      // Prevent clickjacking — app cannot be embedded in iframes
      { key: "X-Frame-Options", value: "DENY" },
      // Prevent MIME-type sniffing attacks
      { key: "X-Content-Type-Options", value: "nosniff" },
      // Content Security Policy — allow self + Razorpay checkout + inline (Next.js requires inline for hydration)
      { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://cdn.tailwindcss.com; img-src 'self' data: https: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com wss: ws:; frame-src https://api.razorpay.com; object-src 'none'; base-uri 'self'; form-action 'self'" },
      // Only send origin to same-origin; full URL for same-origin, origin-only for cross-origin
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // Disable browser features that BizBook Pro does not use
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self), usb=(), magnetometer=(), gyroscope=(), accelerometer=()" },
      // Legacy XSS protection for older browsers (Chrome, IE, Safari)
      { key: "X-XSS-Protection", value: "1; mode=block" },
    ];

    return [
      // === ALL ROUTES: Security headers ===
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // v4.58: Static assets — cache for 1 year (immutable, hashed filenames)
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          ...securityHeaders,
        ],
      },
      {
        // v4.58: Public assets (logos, icons, manifest) — cache for 1 day
        source: "/:path*.(png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot|js|css)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
          ...securityHeaders,
        ],
      },
      {
        // v4.58: API — keep-alive + short cache for GET requests
        source: "/api/:path*",
        headers: [
          { key: "Connection", value: "keep-alive" },
          ...securityHeaders,
        ],
      },
    ];
  },
};

export default nextConfig;
