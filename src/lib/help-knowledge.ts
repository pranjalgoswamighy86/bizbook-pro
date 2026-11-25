/**
 * Shared customer-help content.
 * Keep the in-app FAQ, step-by-step guides, and AI support knowledge aligned.
 */
export const HELP_FAQS = [
  {
    q: 'How do I register my business?',
    a: 'Open the login page and choose Register. Enter the business and account details requested by the form, submit the OTP request, and enter the verification code delivered to your registered contact method. Keep your login credentials private.',
    keywords: ['register', 'business', 'account', 'signup', 'sign up'],
  },
  {
    q: 'I am not receiving my OTP. What should I do?',
    a: 'Check the registered email inbox, spam/junk folder, and SMS inbox. Confirm that the email address or phone number is correct, wait briefly, and use Resend OTP if the option is available. If delivery still fails, contact support and share the approximate time and masked contact details only — never share the OTP.',
    keywords: ['otp', 'verification', 'sms', 'email', 'login'],
  },
  {
    q: 'How do I reset my password?',
    a: 'On the login screen choose Forgot Password, enter the registered email or phone requested by the form, complete OTP verification, and set a new strong password. If the recovery message does not arrive, check spam/SMS and contact support.',
    keywords: ['password', 'forgot', 'reset', 'login'],
  },
  {
    q: 'How do I change my password?',
    a: 'After signing in, open Settings and use the password or account-security option if it is available to your role. Enter the current password and choose a new, unique password. Do not share passwords with support.',
    keywords: ['password', 'change', 'settings', 'security'],
  },
  {
    q: 'How do I buy or renew a subscription?',
    a: 'Open Subscription from the sidebar, review the plans and available usage hours shown on your account, choose the required plan, and complete the secure checkout. Do not pay again if a payment is still pending verification.',
    keywords: ['subscription', 'plan', 'buy', 'renew', 'hours', 'recharge'],
  },
  {
    q: 'I paid but my plan or wallet has not updated. What should I do?',
    a: 'First confirm the payment status in your bank or UPI app, then refresh the Subscription page and check the payment history. Allow a short time for verification. If it remains pending, contact support with the payment reference, amount, date and time. Never send a card number, UPI PIN, password or OTP.',
    keywords: ['payment', 'razorpay', 'upi', 'wallet', 'plan', 'pending'],
  },
  {
    q: 'How do I create a sales invoice?',
    a: 'Open Inventory and confirm that the required products or services exist. Open Sale Register, choose New Sale, select or enter the customer, add line items and quantities, review tax and totals, then save. Review the saved invoice before printing, downloading or sharing it.',
    keywords: ['sale', 'sales', 'invoice', 'customer', 'billing'],
  },
  {
    q: 'How do I enter a purchase invoice?',
    a: 'Open Purchase Register, start a new purchase, select or enter the supplier, add the purchased items, quantities, rates and tax details, verify the bill total and save. Check the purchase register and inventory balances after saving.',
    keywords: ['purchase', 'supplier', 'vendor', 'bill', 'stock'],
  },
  {
    q: 'How does AI Smart Import work?',
    a: 'Open AI Smart Import, upload a supported CSV, TSV, Excel, JSON, PDF, image, text, XML or Word file, choose a document category if known, and review the detected records, warnings and confidence before selecting modules and importing. AI output is a draft: verify names, dates, quantities, GST rates and totals before committing it.',
    keywords: ['ai', 'smart import', 'import', 'csv', 'excel', 'pdf', 'upload'],
  },
  {
    q: 'Does AI Smart Import always read every row in a spreadsheet?',
    a: 'The current spreadsheet analysis sends a sample of up to 30 rows per sheet to the AI model. Larger sheets can therefore have rows that are not included in the AI preview. Check the explicit partial-extraction warning and do not treat a sample preview as a complete migration. Split the file into smaller batches or use a verified import workflow for the remaining rows.',
    keywords: ['rows', 'spreadsheet', 'excel', 'partial', 'missing', 'import'],
  },
  {
    q: 'Can I import records without reviewing them?',
    a: 'No. Treat AI extraction as a suggested draft. Review the preview, select only the intended modules, verify duplicates and financial values, and explicitly confirm the import. Keep a backup before large imports.',
    keywords: ['review', 'confirm', 'import', 'duplicate', 'backup'],
  },
  {
    q: 'Why did AI Smart Import reject or skip a record?',
    a: 'Open the import results and read the error reported for each failed or skipped record. Common causes include missing or invalid dates, party names, quantities, rates, line items, or insufficient stock. Correct the source data, review duplicate warnings, and retry only after confirming that successful records will not be imported again.',
    keywords: ['failed', 'error', 'skipped', 'validation', 'stock', 'retry', 'ai import'],
  },
  {
    q: 'Can I import a scanned PDF with AI Smart Import?',
    a: 'Searchable PDFs can be read from their text. Scanned PDFs need image rendering; if the upload reports that rendering failed, convert the PDF to a searchable PDF or upload clear page images. A scanned multi-page PDF may be analyzed from page 1 only, so read the partial-extraction warning and process the remaining pages separately.',
    keywords: ['scanned', 'pdf', 'ocr', 'image', 'pages', 'ai import'],
  },
  {
    q: 'Does entering a GSTIN automatically verify and fill party details?',
    a: 'The GSTIN field performs local format, state-code, PAN-structure and checksum validation. This does not prove that a GST registration is active and does not fetch the legal name or address. Verify the taxpayer on the official GST Portal and enter the confirmed party details in BizBook Pro.',
    keywords: ['gstin', 'party', 'customer', 'supplier', 'lookup', 'details'],
  },
  {
    q: 'How do I generate an E-Invoice (IRN)?',
    a: 'Open the relevant B2B sale in Sale Register and choose the E-Invoice action. Complete any missing seller/buyer address PIN details and verify GSTIN, HSN, invoice date, item values and tax totals. If this business has its own GSP credentials configured, use the live generation option. Otherwise download the GST INV-01 JSON, submit it through the IRP selected by the business, then record the returned IRN and acknowledgement details. BizBook Pro does not choose a provider for the business.',
    keywords: ['e-invoice', 'einvoice', 'irn', 'irp', 'gst', 'pin'],
  },
  {
    q: 'How do I generate an E-Way Bill?',
    a: 'Open the relevant sale in Sale Register and choose EWB. Enter the transport distance and the required vehicle, transporter and transport-document details. Use the business’s configured GSP for live generation, or download the EWB JSON and submit it through the service selected by the business. Record the EWB number, generation time and validity exactly as returned by that service.',
    keywords: ['eway', 'e-way', 'ewb', 'vehicle', 'transporter', 'distance'],
  },
  {
    q: 'Can BizBook Pro file GST returns or give tax/legal advice?',
    a: 'BizBook Pro provides GST-related records, calculations and reports to support your workflow. A report or generated JSON is not proof that a return has been filed or accepted. Confirm statutory applicability, filing deadlines and final tax treatment with your GST practitioner or authorised professional.',
    keywords: ['gst return', 'gstr', 'filing', 'tax', 'legal', 'compliance'],
  },
  {
    q: 'How do I check inventory or correct stock?',
    a: 'Open Inventory to review item balances and item details. Record purchases and sales through their registers so the related stock movements are posted. Use the authorised stock adjustment workflow for corrections and investigate negative-stock or insufficient-stock warnings before retrying.',
    keywords: ['inventory', 'stock', 'quantity', 'adjustment', 'product'],
  },
  {
    q: 'How do I add staff or users?',
    a: 'A user with the required administrator role should open Settings, find the user-management section, and add the person with the minimum role needed. Confirm that the new user can access only the intended business and functions.',
    keywords: ['staff', 'users', 'roles', 'permissions', 'settings'],
  },
  {
    q: 'How do I create or restore a backup?',
    a: 'Open Backup & Restore and review the available backup options for the selected business. Create a fresh backup before a large import or restore. Restore only a backup that belongs to the intended tenant and follow the confirmation steps carefully; a restore can replace existing data.',
    keywords: ['backup', 'restore', 'export', 'data recovery'],
  },
  {
    q: 'How do I contact a human support person?',
    a: 'Open Help & Support and select AI Support Chat. Describe the issue, the screen or module involved, and the approximate time it happened. Ask explicitly for a human if needed; the conversation is flagged for the support team. Do not share passwords, OTPs, API secrets or full payment credentials.',
    keywords: ['support', 'human', 'agent', 'help', 'ticket', 'escalate'],
  },
] as const

export const HELP_GUIDES = [
  {
    icon: 'user-plus',
    title: 'Register your business',
    steps: [
      'Open the login page and choose Register',
      'Enter the business and account details requested by the form',
      'Request the verification OTP and check the registered email/SMS',
      'Enter the OTP and complete registration',
      'Sign in and confirm that the correct business workspace is selected',
    ],
  },
  {
    icon: 'key',
    title: 'Recover access or reset your password',
    steps: [
      'Open the login page and choose Forgot Password',
      'Enter the registered contact detail requested by the form',
      'Request an OTP and check the inbox, spam folder and SMS',
      'Complete verification and choose a strong new password',
      'Sign in again; never share the OTP or password with anyone',
    ],
  },
  {
    icon: 'credit-card',
    title: 'Buy or renew a subscription',
    steps: [
      'Sign in to the correct business workspace',
      'Open Subscription from the sidebar',
      'Compare the plans and usage hours currently displayed',
      'Choose the plan and complete secure checkout',
      'Refresh the page and confirm that the payment and plan status updated',
      'If pending, contact support with the payment reference instead of paying twice',
    ],
  },
  {
    icon: 'file-text',
    title: 'Create your first sales invoice',
    steps: [
      'Open Inventory and add the products or services you sell',
      'Open Sale Register and choose New Sale',
      'Select or add the customer and add the invoice line items',
      'Enter quantities, rates, discounts and applicable tax details',
      'Review the invoice date, item totals, GST and grand total',
      'Save, then review the saved invoice before printing or sharing',
    ],
  },
  {
    icon: 'file-text',
    title: 'Record a purchase',
    steps: [
      'Open Purchase Register and choose New Purchase',
      'Select or add the supplier',
      'Add purchased products, quantities, rates and tax details',
      'Check the supplier bill number, date and grand total',
      'Save and confirm the purchase appears in the register',
      'Review inventory balances and resolve any stock warnings',
    ],
  },
  {
    icon: 'lightbulb',
    title: 'Use AI Smart Import safely',
    steps: [
      'Open AI Smart Import and upload a supported file',
      'Choose the closest document category, or leave auto-detect selected',
      'Wait for analysis and inspect the detected type, confidence and warnings',
      'Check every row shown in the preview, especially dates, quantities, GST and totals',
      'If a spreadsheet warning says only 30 rows per sheet were analyzed, split the source into smaller batches; do not assume remaining rows were imported',
      'Select the intended modules and confirm the import only after reviewing the data',
      'Check the import results and reconcile totals against the source file',
    ],
  },
  {
    icon: 'shield',
    title: 'Verify GSTIN and party details',
    steps: [
      'Open the customer or supplier form',
      'Enter the 15-character GSTIN and review the local format/checksum result',
      'Open the official GST Portal taxpayer search to verify registration status',
      'Compare the legal name and registered address with the party’s documents',
      'Enter the verified address and six-digit PIN in the party record',
      'Save and recheck the party before using it on a GST invoice',
    ],
  },
  {
    icon: 'file-text',
    title: 'Generate an E-Invoice',
    steps: [
      'Confirm the business GSTIN and the buyer GSTIN on the sale',
      'Verify the seller and buyer registered addresses, valid PIN codes and item HSN details',
      'Check invoice number, date, taxable values, tax split and grand total',
      'Open the E-Invoice action in Sale Register',
      'Use the tenant’s configured GSP for live generation, or download GST INV-01 JSON',
      'For manual submission, use the IRP chosen by the business and record the returned IRN, Ack No. and Ack Date',
      'Reopen the invoice and confirm the saved IRN status',
    ],
  },
  {
    icon: 'file-text',
    title: 'Generate an E-Way Bill',
    steps: [
      'Open the relevant sale in Sale Register and choose EWB',
      'Enter the transport distance and mode of transport',
      'Enter the vehicle number or registered transporter GSTIN and any transport document details required',
      'Use the tenant’s configured GSP for live generation, or download the EWB JSON',
      'Submit manual JSON through the E-Way Bill service selected by the business',
      'Record the exact 12-digit EWB number, generation date/time and validity date/time returned by the service',
      'Confirm the EWB status on the sale',
    ],
  },
  {
    icon: 'file-text',
    title: 'Resolve AI Smart Import warnings and failed records',
    steps: [
      'Open AI Smart Import and read every warning before confirming an import',
      'If a spreadsheet warning says only the first 30 rows per sheet were analyzed, split the original file into smaller batches',
      'If a scanned PDF cannot be rendered, convert it to a searchable PDF or upload clear page images; process additional pages separately when the preview is partial',
      'Review failed-record messages and correct missing dates, party names, item descriptions, quantities, rates and totals in the source or preview',
      'Check duplicate and stock warnings before retrying so that successful records are not imported twice',
      'Create or confirm a recent backup before a large re-import',
      'After importing, compare created, skipped and failed counts and reconcile totals against the original source',
    ],
  },
  {
    icon: 'shield',
    title: 'Create a backup before major changes',
    steps: [
      'Select the correct business workspace',
      'Open Backup & Restore',
      'Create a fresh backup and confirm it completed successfully',
      'Keep a copy in an approved secure location',
      'Before restoring, verify the tenant and backup date; restore only when authorised',
      'After restore, check key ledgers, sales, purchases and inventory balances',
    ],
  },
] as const
