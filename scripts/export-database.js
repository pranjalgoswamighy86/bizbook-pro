#!/usr/bin/env node
/**
 * Database Export Script — Exports all tables to JSON
 * Run: node scripts/export-database.js
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function exportDatabase() {
  console.log('Starting database export...');
  const exportData = {
    exportDate: new Date().toISOString(),
    version: 'v4.84',
    tables: {}
  };

  const tables = [
    'tenant', 'user', 'userTenant', 'sale', 'purchase', 'expense',
    'inventoryItem', 'debtor', 'creditor', 'account', 'journalEntry',
    'journalEntryLine', 'staff', 'salaryPayment', 'subscription',
    'subscriptionQueue', 'auditLog', 'helpSupportTicket',
    'payment', 'receipt', 'party', 'product', 'productIngredient',
    'batch', 'priceList', 'bankTransaction', 'bankStatementUpload',
    'attendanceRecord',
  ];

  for (const table of tables) {
    try {
      const records = await prisma[table].findMany({ take: 10000 });
      exportData.tables[table] = records;
      console.log(`  ${table}: ${records.length} records`);
    } catch (err) {
      console.log(`  ${table}: skipped (not found or error)`);
      exportData.tables[table] = [];
    }
  }

  const outputPath = path.join('/home/z/my-project/download', 'database_export.json');
  fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
  console.log(`\nExport complete: ${outputPath}`);
  console.log(`Total tables: ${Object.keys(exportData.tables).length}`);

  await prisma.$disconnect();
}

exportDatabase().catch(err => {
  console.error('Export failed:', err);
  process.exit(1);
});
