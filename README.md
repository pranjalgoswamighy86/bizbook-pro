# BizBook Pro

Production-grade multi-tenant business management SaaS for Indian SMEs:
**Sales · Purchases · Inventory · Bank · GST · Accounting · AI Import · AI Support**.

Deployed on Railway with PostgreSQL. Multi-business, role-based, subscription-billed.

## Architecture

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 16 (App Router, Turbopack, standalone output), React 19, TypeScript, Tailwind CSS 4, shadcn/ui |
| **Backend** | Next.js Route Handlers (50+ API routes), Prisma ORM v6 |
| **Database** | PostgreSQL (Railway managed) — multi-tenant, soft-delete, audit-logged |
| **Auth** | Cookie-based sessions, scrypt password hashing, OTP (Brevo email + 2Factor SMS), TOTP 2FA |
| **Payments** | Razorpay checkout + UPI deep-link, subscription wallet with time-based usage deduction |
| **AI** | Multi-provider (Gemini, OpenAI, DeepSeek) — Smart Import, Invoice Analyzer, Support Chat, Smart Search, Valuation |
| **Accounting** | Double-entry General Ledger, Journal Entry balance assertion (Dr=Cr ±0.01), Trial Balance, P&L, Balance Sheet |
| **GST** | GSTIN validation + checksum, CGST/SGST/IGST split, HSN validation, e-invoice IRN/IRP integration, GSTR reports |
| **Desktop** | Electron wrapper (Windows/macOS/Linux) with fingerprint binding |
| **Offline** | IndexedDB cache, Service Worker, queued writes with sync |

## Modules

| Module | Key Features |
|---|---|
| **Dashboard** | KPI cards, 7-day charts, receivables/payables, recent activity |
| **Sales** | GST invoices, quotations, receipts, multi-item, discount, payment tracking, debtor management |
| **Purchases** | Supplier bills, GST input credit, GRN, creditor management |
| **Inventory** | Product master, BOM/recipes, batch & expiry, barcode, HSN, multi-unit, low-stock alerts, anti-negative-stock enforcement |
| **Price Lists** | Multiple selling-price structures per product |
| **Bank** | Multi-account, manual + auto transactions, bank statement import, reconciliation |
| **Accounting** | Chart of Accounts, Journal Entries, General Ledger, Trial Balance, P&L, Balance Sheet |
| **GST** | Output/Input GST, slab-wise breakdown, net payable, ITC carry-forward, GSTR-1/3B/9 reports |
| **Parties** | Customers, suppliers, debtors, creditors, opening balances |
| **Staff** | Staff records, salary, attendance, salary accrual + payment accounting |
| **Expenses** | Expense register with category, payment mode, GL posting |
| **Reports** | Day report, P&L summary, debtors/creditors aging, GST returns |
| **AI Smart Import** | Upload CSV/Excel/PDF/image → AI extracts structured sales/purchases/expenses → review → apply (with GL posting + inventory sync) |
| **AI Invoice Analyzer** | Upload invoice photo/PDF → AI extracts purchase data → auto-create purchase + update inventory |
| **AI Support Chat** | In-app AI assistant with auto-ticket creation, category classification, rate limiting |
| **Backup** | Excel export/import, Google Drive auto-backup, emergency restore |
| **Settings** | Company info, GSTIN, currency, invoice prefix, user management, RBAC |

## Security

- **Multi-tenant isolation** — every query is tenant-scoped; `requireAuthAndTenant` on all routes
- **5-tier RBAC** — SUPER_ADMIN, ADMIN, MANAGER, ACCOUNTANT, VIEWER
- **OTP authentication** — Brevo email OTP (production), 2Factor SMS OTP (requires API key)
- **Rate limiting** — login (5/min/IP), help-chat (10/min/user), API-wide
- **Security headers** — HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- **Audit log** — append-only, records every create/update/delete with JSON diff
- **Soft delete** — all data tables use `isDeleted` + `deletedAt` (reversible for 30 days)
- **Optimistic locking** — prevents concurrent-edit data loss

## Deployment

### Railway (Production)

Auto-deploys from `main` branch on push.

```
Railway → GitHub webhook → build (Nixpacks) → deploy → PostgreSQL volume
```

Required environment variables:
- `DATABASE_URL` — PostgreSQL connection string
- `SESSION_SECRET` — strong random secret for JWT signing
- `BREVO_API_KEY` — Brevo (Sendinblue) API key for email OTP
- `TWOFACTOR_API_KEY` — 2factor.in API key for SMS OTP (optional)
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — Razorpay payment gateway
- `GEMINI_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` — AI providers (at least one)

### Local Development

```bash
npm install
npx prisma generate
npx prisma db push
npm run dev
```

Open http://localhost:3000

### Desktop (Electron)

```bash
npm run electron:build
```

Produces installers for Windows (.exe), macOS (.dmg), Linux (.AppImage).

## Version

Single source of truth: `src/lib/version.ts` exports `APP_VERSION`.

The version badge in the UI and the system prompt for AI Support Chat both read from this file.

## License

Private. (c) 2026 Tahigo International. All rights reserved.
