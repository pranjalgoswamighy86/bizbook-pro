// Single source of truth for app version
// Update this when pushing a new version
// v6.30.7: bumped from stale v6.28.26 — version.ts was forgotten in the
// v6.29.x–v6.30.6 banner bumps, so the UI VersionBadge + Settings page
// showed v6.28.26 while the actual deployed code was v6.30.6.
// v6.30.8: AI Support Chat routing fix — needsHumanSupport is now computed
// (was hardcoded true), category is auto-classified by module, optimizedQuery
// is a trimmed ≤80-char title, 10/min/user rate limit added, system prompt
// now includes app version + feature list. Stress test 580/580 100%.
// v6.30.9: AI Smart Import inventory synchronization — imported sales now
// decrease stock and imported purchases increase stock inside the same
// per-record transaction as the Sale/Purchase row + GL JE. Anti-negative
// guard throws INSUFFICIENT_STOCK and rolls back the whole record. BOM
// ingredient deduction for FINISHED_PRODUCT items. Unknown items auto-
// created at 0 stock (matches live sales route behavior).
// v6.30.10: BBP.pdf audit fixes — README updated from SQLite to PostgreSQL
// SaaS architecture; frontend file picker no longer advertises .odt/.rtf
// (backend never supported them, users got confusing "unsupported file
// type" errors). GSTIN validator verified correct against official GSTN
// format (10-char PAN at positions 3-12, entity at 13, Z at 14, checksum
// at 15). Help-chat frontend/backend contract verified aligned.
// v6.30.11: E-invoice PIN code capture + manual IRIS IRP handoff — both
// e-invoice API paths return a structured PIN_CODE_REQUIRED response when
// seller/buyer PIN is missing; Sales Register prompts and retries with
// validated six-digit PINs. Sale register's "Record IRN" button completes
// the B2B manual IRP workflow: generate INV-01 payload → submit on IRIS
// portal → paste back IRN/AckNo/AckDate. IRN validated as 64 hex chars;
// cancellation enforced only within the 24-hour IRP window.
// v6.30.12: Inventory SERVICE item type + Purchase Record IRN — inventory
// item type dropdown now includes "Service" alongside Raw Material and
// Finished Product (purple badge), so service businesses can maintain
// SAC-coded catalog items. Purchase register now has a "Record IRN" button
// for B2B purchases with a GST-registered supplier, completing the manual
// e-invoice workflow on the purchase side (the supplier generates the IRN;
// the buyer records it). Green FileCheck icon appears next to the invoice
// number once IRN is recorded.
// v6.31.0: E-Way Bill (EWB) implementation — new src/lib/ewb-integration.ts
// and /api/eway-bill route with 6 actions: generate-payload (builds EWB JSON
// by IRN or direct), update-status (manual record), cancel, extend, status,
// ewb-status. Supports both LIVE (GSP) and MANUAL (portal submission) modes,
// matching the e-invoice pattern. Sale model gains 12 EWB fields:
// ewayBillNo (12-digit), ewayBillDate, ewayBillValidUpto, ewayBillStatus,
// transporterId, transporterName, vehicleNo, modeOfTransport, distanceKm,
// ewayBillCanceledAt, ewayBillCancelReason. Tenant model gains
// einvoiceAutoGenerate + ewbAutoGenerate toggles for future auto-mode.
// EWB validity auto-calculated as 1 day per 200 km (min 1, max 30 days).
// Cancellation enforced within validity window only. Extension requires new
// vehicle number before expiry. Sale register gains "Generate EWB" and
// "Record EWB" buttons (truck icon) alongside the existing "Record IRN"
// button. Blue truck badge appears next to invoice number once EWB is recorded.
export const APP_VERSION = 'v6.31.0'
export const APP_BUILD_DATE = '2026-11-24'