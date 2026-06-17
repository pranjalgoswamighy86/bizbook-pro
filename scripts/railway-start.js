const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('=== BizBook Pro Startup ===');

// Create db directory
fs.mkdirSync('db', { recursive: true });

// Push Prisma schema
console.log('→ Syncing database schema...');
try {
  execSync('npx prisma db push --skip-generate', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'file:./db/custom.db' } });
} catch (e) {
  console.log('⚠️ Prisma db push failed (might already exist)');
}

// Seed admin user
console.log('→ Checking for admin user...');
try {
  execSync('node scripts/seed-admin.js', { stdio: 'inherit', env: process.env });
} catch (e) {
  console.log('⚠️ Seed failed (might already exist)');
}

// Start the server
console.log('→ Starting Next.js server...');
require('./.next/standalone/server.js');
