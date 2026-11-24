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
// v6.30.11: E-invoice manual workflow UI completion — purchase register
// now has a "Record IRN" button to enter supplier-issued IRN +
// acknowledgement details (buyer never generates purchase IRN; the
// supplier does). Inventory item type dropdown now includes "Service"
// alongside Raw Material and Finished Product, so service businesses can
// mark SAC-coded items correctly (IsServc=Y in INV-01 payload). Sale
// register's "Record IRN" button (added in v6.30.10 via PR #8) completes
// the B2B manual IRP handoff: generate payload → submit on IRIS portal →
// paste back IRN/AckNo/AckDate.
export const APP_VERSION = 'v6.30.11'
export const APP_BUILD_DATE = '2026-11-24'
