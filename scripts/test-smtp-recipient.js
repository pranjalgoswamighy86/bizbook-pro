#!/usr/bin/env node
'use strict'

// Retired SMTP diagnostic utility.
// The previous version embedded provider credentials. Never commit SMTP
// passwords or API keys. Configure credentials through the deployment secret
// manager and use the authenticated application debug tools for diagnostics.
console.error('This legacy SMTP test script is disabled because provider credentials must not be stored in source control.');
console.error('Set SMTP_USER, SMTP_PASS and SMTP_FROM in the deployment secret manager, then verify delivery using the application.');
process.exitCode = 1;
