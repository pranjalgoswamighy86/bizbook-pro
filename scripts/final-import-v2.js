#!/usr/bin/env node
'use strict'

// Retired historical data-import utility.
// This script used an obsolete restore authentication flow and embedded
// production account/tenant details. It is intentionally disabled.
console.error('This historical production-import utility has been disabled.');
console.error('Use BizBook Pro Settings > Backup & Restore while signed in as the tenant MAIN_ADMIN for tenant-scoped Excel imports.');
console.error('Whole-database recovery requires the configured system administrator session.');
process.exitCode = 1;
