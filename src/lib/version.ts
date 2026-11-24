// Single source of truth for app version
// Update this when pushing a new version
// v6.30.7: bumped from stale v6.28.26 — version.ts was forgotten in the
// v6.29.x–v6.30.6 banner bumps, so the UI VersionBadge + Settings page
// showed v6.28.26 while the actual deployed code was v6.30.6.
// v6.30.8: AI Support Chat routing fix — needsHumanSupport is now computed
// (was hardcoded true), category is auto-classified by module, optimizedQuery
// is a trimmed ≤80-char title, 10/min/user rate limit added, system prompt
// now includes app version + feature list. Stress test 580/580 100%.
export const APP_VERSION = 'v6.30.8'
export const APP_BUILD_DATE = '2026-11-24'
