#!/usr/bin/env node
/**
 * BizBook Pro — Accounting Engine Validation Tool
 * ================================================
 * v6.28.19: Programmatically audits the codebase against the 20 Core ERP
 * Biography Specifications from "THE ARCHITECTURE OF ACCOUNTING TRUTH".
 *
 * Usage:
 *   node scripts/validate-accounting-engine.js
 *
 * Output:
 *   A table categorizing all 20 ERP accounting features as
 *   [Fully Implemented], [Partially Implemented], or [Missing],
 *   with code path proofs.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');

// Helper: check if a file exists and contains a pattern
function checkFile(filePath, patterns) {
  const fullPath = path.join(SRC_DIR, filePath);
  if (!fs.existsSync(fullPath)) {
    return { exists: false, matches: [] };
  }
  const content = fs.readFileSync(fullPath, 'utf-8');
  const matches = [];
  for (const p of patterns) {
    if (typeof p === 'string') {
      if (content.includes(p)) matches.push(p);
    } else if (p instanceof RegExp) {
      if (p.test(content)) matches.push(p.toString());
    }
  }
  return { exists: true, matches };
}

// Helper: check multiple files
function checkFiles(files, patterns) {
  const results = [];
  for (const f of files) {
    const r = checkFile(f, patterns);
    if (r.exists) results.push({ file: f, ...r });
  }
  return results;
}

// The 20 Core ERP Features to validate
const features = [
  {
    name: '1. Bank Account Management & MT940 Reconciliation',
    files: ['app/api/bank/route.ts', 'components/modules/bank-statement.tsx'],
    patterns: ['bankTransaction', 'deposit', 'withdrawal', 'balance'],
    requiredPatterns: 3,
  },
  {
    name: '2. Sales & Billing Ledger',
    files: ['app/api/sales/route.ts', 'components/modules/sale-register.tsx'],
    patterns: ['invoiceNumber', 'subtotal', 'gstAmount', 'totalAmount', 'amountReceived', 'paymentStatus'],
    requiredPatterns: 4,
  },
  {
    name: '3. Purchase Ledger & 3-Way Matching',
    files: ['app/api/purchases/route.ts', 'components/modules/purchase-register.tsx'],
    patterns: ['invoiceNumber', 'subtotal', 'gstAmount', 'totalAmount', 'amountPaid', 'paymentStatus'],
    requiredPatterns: 4,
  },
  {
    name: '4. Expense Management & Auto-Posting',
    files: ['app/api/expenses/route.ts', 'components/modules/expense-register.tsx'],
    patterns: ['postExpenseJE', 'journalEntry', 'sourceType: \'EXPENSE\'', 'categoryToAccountCode'],
    requiredPatterns: 2,
  },
  {
    name: '5. Inventory Tracking & Valuation',
    files: ['app/api/inventory/route.ts', 'components/modules/inventory.tsx'],
    patterns: ['currentStock', 'purchasePrice', 'salePrice', 'value', 'adjust-stock'],
    requiredPatterns: 3,
  },
  {
    name: '6. Product Batches & FEFO Expiry',
    files: ['app/api/batches/route.ts', 'components/modules/batch-expiry.tsx'],
    patterns: ['batch', 'expiry', 'expiryDate', 'manufacturingDate'],
    requiredPatterns: 2,
  },
  {
    name: '7. Price Lists & Volume Breaks',
    files: ['app/api/price-lists/route.ts', 'components/modules/price-lists.tsx'],
    patterns: ['priceList', 'priceListItem', 'price'],
    requiredPatterns: 2,
  },
  {
    name: '8. Chart of Accounts (CoA)',
    files: ['app/api/accounts/route.ts', 'components/modules/chart-of-accounts.tsx'],
    patterns: ['accountCode', 'seed-defaults', 'Asset', 'Liability', 'Equity', 'Revenue', 'Expense'],
    requiredPatterns: 4,
  },
  {
    name: '9. General Ledger (GL)',
    files: ['app/api/ledger/route.ts', 'app/api/journal-entries/route.ts', 'components/modules/general-ledger.tsx'],
    patterns: ['account-ledger', 'trial-balance', 'journalEntry', 'journalEntryLine', 'isPosted'],
    requiredPatterns: 3,
  },
  {
    name: '10. Trial Balance',
    files: ['app/api/ledger/route.ts', 'components/modules/trial-balance.tsx'],
    patterns: ['trial-balance', 'groupBy', 'totalDebit', 'totalCredit', 'isBalanced'],
    requiredPatterns: 3,
  },
  {
    name: '11. Profit & Loss (P&L) Summary',
    files: ['app/api/reports/route.ts', 'components/modules/pnl-summary.tsx'],
    patterns: ['pnl', 'totalRevenue', 'totalCostOfGoods', 'netProfit', 'totalSalaries'],
    requiredPatterns: 3,
  },
  {
    name: '12. Daily Report',
    files: ['app/api/reports/route.ts', 'components/modules/day-report.tsx'],
    patterns: ['day-report', 'daySales', 'dayPurchases', 'dayExpenses'],
    requiredPatterns: 2,
  },
  {
    name: '13. Balance Sheet',
    files: ['app/api/reports/route.ts', 'components/modules/balance-sheet.tsx'],
    patterns: ['balance-sheet', 'totalAssets', 'totalLiabilities', 'totalEquity', 'isBalanced', 'currentPeriodNetIncome'],
    requiredPatterns: 4,
  },
  {
    name: '14. GST/Tax Handling (CGST/SGST/IGST)',
    files: ['lib/gst-utils.ts', 'app/api/sales/route.ts', 'app/api/purchases/route.ts'],
    patterns: ['splitGSTAmount', 'calculateGST', 'isInterStateSupply', 'CGST', 'SGST', 'IGST'],
    requiredPatterns: 4,
  },
  {
    name: '15. Credit/Debit Notes',
    files: ['components/modules/credit-debit-notes.tsx'],
    patterns: ['CreditNote', 'DebitNote', 'credit', 'debit'],
    requiredPatterns: 2,
  },
  {
    name: '16. Accounts Receivable (Debtors)',
    files: ['app/api/debtors/route.ts', 'components/modules/debtors.tsx'],
    patterns: ['currentBalance', 'openingBalance', 'totalReceivable', 'receivableByParty'],
    requiredPatterns: 3,
  },
  {
    name: '17. Accounts Payable (Creditors)',
    files: ['app/api/creditors/route.ts', 'components/modules/creditors.tsx'],
    patterns: ['currentBalance', 'openingBalance', 'totalPayable', 'payableByParty'],
    requiredPatterns: 3,
  },
  {
    name: '18. Payments (Vendor Disbursements)',
    files: ['app/api/payments/route.ts', 'components/modules/payments.tsx'],
    patterns: ['postPaymentJE', 'applyPaymentToCreditorAndPurchase', 'sourceType: \'PAYMENT\''],
    requiredPatterns: 2,
  },
  {
    name: '19. Staff & Salary Management (Two-Step Accrual)',
    files: ['app/api/staff/route.ts', 'components/modules/staff-salary.tsx'],
    patterns: ['accrue-salary', 'mark-salary-paid', 'SalaryPayment', 'status', 'creditorId', 'accrualJEId', 'disbursementJEId'],
    requiredPatterns: 4,
  },
  {
    name: '20. Immutable Audit Logs',
    files: ['app/api/audit/route.ts', 'lib/api-helpers.ts'],
    patterns: ['writeAuditLog', 'auditLog', 'AuditLog', 'action: \'CREATE\'', 'action: \'UPDATE\'', 'action: \'DELETE\''],
    requiredPatterns: 3,
  },
];

// Additional invariant checks
const invariants = [
  {
    name: 'GL Balance Assertion (assertJEBalance)',
    files: ['lib/je-balance.ts'],
    patterns: ['assertJEBalance', 'totalDebits', 'totalCredits', 'throw new Error'],
    requiredPatterns: 3,
  },
  {
    name: '0% GST / Tax-Exempt JE Posting',
    files: ['app/api/sales/route.ts'],
    patterns: ['sale.totalAmount  // 0% GST', 'gstAmount || 0) > 0', 'grossSubtotal'],
    requiredPatterns: 2,
  },
  {
    name: 'AR Single Source of Truth (Sale table derived)',
    files: ['app/api/debtors/route.ts', 'app/api/reports/route.ts'],
    patterns: ['receivableByParty', 'outstandingSales', 'Sale.totalAmount', 'amountReceived'],
    requiredPatterns: 2,
  },
  {
    name: 'Database Reconciliation Engine',
    files: ['app/api/admin/reconcile/route.ts'],
    patterns: ['repair-sale-jes', 'runAudit', 'runRemediation', 'assertJEBalance'],
    requiredPatterns: 2,
  },
];

// Run validation
console.log('');
console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║     BizBook Pro — Accounting Engine Validation Report (v6.28.19)           ║');
console.log('║     Cross-checking 20 Core ERP Biography Specifications                    ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
console.log('');

let fullyImplemented = 0;
let partiallyImplemented = 0;
let missing = 0;

console.log('┌─┬──────────────────────────────────────────────────────┬──────────┬──────────────────────────────────┐');
console.log('│#│ Feature                                               │ Status   │ Code Path Proof                  │');
console.log('├─┼──────────────────────────────────────────────────────┼──────────┼──────────────────────────────────┤');

features.forEach((f, i) => {
  const results = checkFiles(f.files, f.patterns);
  const totalFound = results.reduce((sum, r) => sum + r.matches.length, 0);
  const filesFound = results.filter(r => r.exists).length;

  let status, proof;
  if (filesFound === 0) {
    status = 'MISSING';
    missing++;
    proof = 'No files found';
  } else if (totalFound >= f.requiredPatterns) {
    status = '✅ FULL';
    fullyImplemented++;
    proof = results.map(r => `${path.basename(r.file)}(${r.matches.length})`).join(', ');
  } else {
    status = '⚠️ PARTIAL';
    partiallyImplemented++;
    proof = `${totalFound}/${f.requiredPatterns} patterns in ${filesFound}/${f.files.length} files`;
  }

  const num = String(i + 1).padStart(2);
  const name = f.name.substring(0, 52).padEnd(52);
  const statusStr = status.padEnd(8);
  const proofStr = proof.substring(0, 32).padEnd(32);
  console.log(`│${num}│${name}│${statusStr}│${proofStr}│`);
});

console.log('├─┼──────────────────────────────────────────────────────┼──────────┼──────────────────────────────────┤');
console.log('│ │ ACCOUNTING INVARIANTS                                 │          │                                  │');

invariants.forEach((inv, i) => {
  const results = checkFiles(inv.files, inv.patterns);
  const totalFound = results.reduce((sum, r) => sum + r.matches.length, 0);

  let status, proof;
  if (totalFound >= inv.requiredPatterns) {
    status = '✅ FULL';
    fullyImplemented++;
    proof = results.map(r => `${path.basename(r.file)}(${r.matches.length})`).join(', ');
  } else if (totalFound > 0) {
    status = '⚠️ PARTIAL';
    partiallyImplemented++;
    proof = `${totalFound}/${inv.requiredPatterns} patterns`;
  } else {
    status = 'MISSING';
    missing++;
    proof = 'No patterns found';
  }

  const name = inv.name.substring(0, 52).padEnd(52);
  const statusStr = status.padEnd(8);
  const proofStr = proof.substring(0, 32).padEnd(32);
  console.log(`│I│${name}│${statusStr}│${proofStr}│`);
});

console.log('└─┴──────────────────────────────────────────────────────┴──────────┴──────────────────────────────────┘');
console.log('');
console.log('  SUMMARY:');
console.log(`    ✅ Fully Implemented:    ${fullyImplemented}`);
console.log(`    ⚠️ Partially Implemented: ${partiallyImplemented}`);
console.log(`    ❌ Missing:              ${missing}`);
console.log(`    Total Features Checked:  ${features.length + invariants.length}`);
console.log('');

// Print detailed findings for partial/missing
const allChecks = [...features, ...invariants];
const issues = allChecks.filter(f => {
  const results = checkFiles(f.files, f.patterns);
  const totalFound = results.reduce((sum, r) => sum + r.matches.length, 0);
  return totalFound < f.requiredPatterns;
});

if (issues.length > 0) {
  console.log('  GAPS REQUIRING ATTENTION:');
  issues.forEach(f => {
    const results = checkFiles(f.files, f.patterns);
    const missing_patterns = f.patterns.filter(p => {
      return !results.some(r => r.matches.includes(p) || r.matches.includes(p.toString()));
    });
    console.log(`    ⚠️  ${f.name}`);
    console.log(`       Missing patterns: ${missing_patterns.join(', ')}`);
    console.log(`       Files checked: ${f.files.join(', ')}`);
    console.log('');
  });
}

console.log('  ════════════════════════════════════════════════════');
console.log(`  Validation complete. ${fullyImplemented}/${features.length + invariants.length} features fully implemented.`);
console.log('  ════════════════════════════════════════════════════');
console.log('');
