# BizBook Pro v2.0

Self-hosted business management: **Sales · Purchases · Inventory · Bank · GST · AI Import**.
All data stays on your machine (SQLite). No cloud, no subscription.

## Quick Start

### Prerequisites
- **Node.js 18+** — Download from https://nodejs.org

### Run

**Windows:** Double-click `START.bat`
**Linux / macOS:** Run `./start.sh` in a terminal

Then open http://localhost:3000 in your browser.

On first launch you'll be prompted to create an admin account. After that, the app is ready to use.

## What's Included

| Module | Features |
|---|---|
| **Dashboard** | KPI cards (sales, purchases, profit, bank balance), 7-day sales/purchases bar chart, recent sales |
| **Sales** | Create invoices with multiple line items, GST calculation, payment mode, auto invoice number |
| **Purchases** | Record supplier bills, GST tracking, auto bill number |
| **Inventory** | Product master with SKU, sale/purchase prices, GST rate, opening stock |
| **Bank** | Multiple accounts, manual transactions, auto-entries from sales/purchases |
| **GST** | Output GST vs Input GST, slab-wise breakdown, net payable, ITC carry-forward |
| **AI Import** | Bulk import products or sales via CSV/TSV paste |
| **Settings** | Company info, GSTIN, currency, default GST rate, invoice prefix |

## Architecture

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Next.js API routes (App Router), Prisma ORM
- **Database**: SQLite (file: `bizbook.db`) — portable, no install needed
- **Auth**: Cookie-based sessions with scrypt password hashing

## Production Build

The `.next/standalone/` folder contains the production server. The build pipeline:

1. `next build` — produces standalone server bundle
2. `postbuild` hook runs `scripts/sync-standalone.js` — copies `public/` and `.next/static/` into the standalone folder (this is the bug-fix from v1)
3. `scripts/verify-standalone.js` — pre-flight check before server start

The launchers (`START.bat`, `start.sh`) run the verification automatically before starting the server. If verification fails, they will rebuild automatically.

## File Layout

```
.
├── START.bat                 # Windows launcher
├── start.sh                  # Linux/macOS launcher
├── package.json              # Scripts: build, start, verify, db:push
├── next.config.ts            # output: "standalone"
├── prisma/
│   └── schema.prisma         # Database schema
├── scripts/
│   ├── sync-standalone.js    # postbuild: copies public/ + .next/static/ into standalone/
│   └── verify-standalone.js  # pre-flight check (runs before server start)
├── src/
│   ├── app/
│   │   ├── page.tsx          # Main UI (sidebar + 8 views)
│   │   ├── layout.tsx
│   │   └── api/              # 17 API routes
│   ├── components/
│   │   ├── bizbook/views.tsx # All 8 feature views
│   │   └── ui/               # shadcn/ui components
│   └── lib/
│       ├── auth.ts           # Session/password helpers
│       └── db.ts             # Prisma client
├── public/                   # Static assets
└── .next/                    # Build output (generated)
    └── standalone/           # Production server bundle
        ├── server.js
        ├── .next/static/     # ← sync-standalone.js copies this here
        └── public/           # ← sync-standalone.js copies this here
```

## Backup

Your data is in `bizbook.db` (SQLite file). To back up, just copy this file somewhere safe.

## Troubleshooting

**"404 on /_next/static/*"**
This was the v1 bug. v2 includes `scripts/sync-standalone.js` (postbuild) and `scripts/verify-standalone.js` (pre-start) to ensure static assets are always present. The launchers will auto-rebuild if verification fails.

**"Database does not exist"**
Run `START.bat` (Windows) or `./start.sh` (Linux/macOS) — the launcher auto-creates the database on first run.

**"Port 3000 already in use"**
Edit the launcher script and change `PORT=3000` to a different port. Then open http://localhost:THATPORT

## License

Private. © 2026 BizBook Pro.
