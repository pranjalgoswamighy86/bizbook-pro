import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db-soft-delete'
import { analyzeWithAI } from '@/lib/multi-ai'
import { requireAuthAndTenant } from '@/lib/api-helpers'

// ============================================================
// AI Smart Import API — v6.15
// ============================================================
// Handles TWO types of requests:
// 1. FormData (file upload) — parses Excel/CSV/PDF/images, analyzes with AI
// 2. JSON (search query) — searches across modules with AI summary
//
// v6.15 FIX: The old code tried to JSON.parse FormData, causing
// "No number after minus sign in JSON at position 1" error.

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || ''

    // ============================================================
    // MODE 1: File Upload (FormData)
    // ============================================================
    if (contentType.includes('multipart/form-data')) {
      return await handleFileUpload(req)
    }

    // ============================================================
    // MODE 2: JSON Search Query (legacy)
    // ============================================================
    return await handleSearchQuery(req)
  } catch (error: any) {
    console.error('[AI-Import] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

// ============================================================
// File Upload Handler
// ============================================================
async function handleFileUpload(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File
  const tenantId = formData.get('tenantId') as string
  // v6.19: User-selected category — guides AI analysis instead of pure auto-detect
  const userCategory = (formData.get('category') as string) || 'auto'

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  if (!tenantId) {
    return NextResponse.json({ error: 'No tenant ID provided' }, { status: 400 })
  }

  const auth = await requireAuthAndTenant(req, tenantId)
  if (auth instanceof NextResponse) return auth

  const fileName = file.name.toLowerCase()
  const ext = fileName.split('.').pop() || ''
  const fileSize = file.size

  console.log(`[AI-Import] File: ${file.name}, Size: ${fileSize}, Ext: ${ext}, Category: ${userCategory}`)

  // Read file content
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  let parsedData: any = null
  let dataType = 'unknown'

  // ============================================================
  // Parse by file type
  // ============================================================
  try {
    if (['xlsx', 'xls'].includes(ext)) {
      // Excel file — parse with xlsx library
      const XLSX = await import('xlsx')
      const workbook = XLSX.read(buffer, { type: 'buffer' })
      const sheets: Record<string, any[]> = {}

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName]
        sheets[sheetName] = XLSX.utils.sheet_to_json(sheet, { raw: false, defval: '' })
      }

      parsedData = sheets
      dataType = 'excel'
      console.log(`[AI-Import] Parsed Excel: ${Object.keys(sheets).length} sheet(s), ${Object.values(sheets).reduce((a: number, b: any[]) => a + b.length, 0)} total rows`)
    } else if (['csv', 'tsv'].includes(ext)) {
      // CSV/TSV file — parse as text
      const text = buffer.toString('utf-8')
      const delimiter = ext === 'tsv' ? '\t' : ','
      const lines = text.split('\n').filter(l => l.trim())
      const headers = lines[0].split(delimiter).map(h => h.trim().replace(/"/g, ''))
      const rows = lines.slice(1).map(line => {
        const values = line.split(delimiter).map(v => v.trim().replace(/"/g, ''))
        const row: Record<string, string> = {}
        headers.forEach((h, i) => { row[h] = values[i] || '' })
        return row
      })

      parsedData = { 'Sheet1': rows }
      dataType = 'csv'
      console.log(`[AI-Import] Parsed CSV: ${rows.length} rows, ${headers.length} columns`)
    } else if (['json'].includes(ext)) {
      // JSON file
      parsedData = JSON.parse(buffer.toString('utf-8'))
      dataType = 'json'
      console.log(`[AI-Import] Parsed JSON`)
    } else if (['txt'].includes(ext)) {
      // Text file
      parsedData = { content: buffer.toString('utf-8') }
      dataType = 'text'
      console.log(`[AI-Import] Parsed text: ${buffer.length} bytes`)
    } else if (['pdf'].includes(ext)) {
      // PDF — extract text (basic, no external dependency)
      parsedData = { content: `[PDF file: ${file.name}, ${fileSize} bytes. PDF text extraction requires pdftoppm.]`, note: 'PDF parsing is limited. For best results, convert to Excel/CSV first.' }
      dataType = 'pdf'
      console.log(`[AI-Import] PDF file (limited parsing)`)
    } else if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(ext)) {
      // Image file — convert to base64 for AI vision analysis
      const base64 = buffer.toString('base64')
      const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`
      parsedData = { base64: `data:${mimeType};base64,${base64}`, fileName: file.name }
      dataType = 'image'
      console.log(`[AI-Import] Image file: ${fileSize} bytes`)
    } else if (['xml'].includes(ext)) {
      // XML file (e.g., Tally export)
      const text = buffer.toString('utf-8')
      parsedData = { content: text.substring(0, 10000), note: 'XML file (Tally export or similar)' }
      dataType = 'xml'
      console.log(`[AI-Import] XML file: ${text.length} chars`)
    } else if (['docx', 'doc'].includes(ext)) {
      // Word document — basic text extraction
      parsedData = { content: `[Word document: ${file.name}, ${fileSize} bytes]`, note: 'Word document parsing is limited.' }
      dataType = 'doc'
      console.log(`[AI-Import] Word document (limited parsing)`)
    } else {
      return NextResponse.json({
        error: `Unsupported file type: .${ext}. Supported: xlsx, xls, csv, tsv, json, txt, pdf, png, jpg, xml, docx`,
      }, { status: 400 })
    }
  } catch (parseError: any) {
    console.error('[AI-Import] Parse error:', parseError)
    return NextResponse.json({
      error: `Failed to parse ${ext.toUpperCase()} file: ${parseError.message}`,
    }, { status: 400 })
  }

  // ============================================================
  // AI Analysis
  // ============================================================
  let analysis: any = null

  // v6.19: Build category hint for the AI prompt
  // When the user selects a category (not 'auto'), tell the AI to extract data for that specific category
  const CATEGORY_HINTS: Record<string, string> = {
    auto: '',
    sale_invoice: 'The user has indicated this file contains SALES REGISTER / SALE INVOICE data. Extract: invoice number, date, customer/party name, items (name, qty, rate, amount), subtotal, GST (CGST/SGST/IGST), grand total, payment status. Map to the "sales" module.',
    purchase_invoice: 'The user has indicated this file contains PURCHASE INVOICE data. Extract: bill number, date, supplier/vendor name, items (name, qty, rate, amount), subtotal, GST input credit, grand total, payment status. Map to the "purchases" module.',
    bank_statement: 'The user has indicated this file contains BANK STATEMENT data. Extract: date, description, deposit/credit, withdrawal/debit, running balance, transaction type, category. Map to the "bankTransactions" module.',
    inventory_data: 'The user has indicated this file contains INVENTORY DATA. Extract: product name, HSN/SKU code, category, unit, quantity/stock, purchase price, sale price, MRP, GST rate, opening stock. Map to the "products" module.',
    expense_data: 'The user has indicated this file contains EXPENSE RECORDS. Extract: date, description, amount, category, payment mode (cash/UPI/card/bank), vendor/payee. Map to the "expenses" module.',
    party_data: 'The user has indicated this file contains PARTY DATA (customers/suppliers). Extract: name, type (customer/supplier), address, phone, email, GSTIN, opening balance. Map to the "parties" module.',
    staff_data: 'The user has indicated this file contains STAFF DATA. Extract: name, role/designation, salary, phone, email, join date. Map to the "staff" module.',
    backup_data: 'The user has indicated this file is a BIZBOOK PRO BACKUP file containing multiple module types. Extract all data and categorize into the appropriate modules (sales, purchases, expenses, products, parties, staff, bankTransactions).',
  }
  const categoryHint = CATEGORY_HINTS[userCategory] || ''
  const categoryInstruction = categoryHint
    ? `\n\nIMPORTANT USER INSTRUCTION:\n${categoryHint}\n\nPlease extract the data accordingly. If the file content does not match the user-selected category, still attempt extraction and note any mismatch in the warnings.`
    : ''

  try {
    // Build prompt based on data type
    let prompt = ''
    let imageBase64: string | undefined

    if (dataType === 'excel' || dataType === 'csv') {
      // For spreadsheets, summarize the data structure and content
      const sheets = parsedData as Record<string, any[]>
      const sheetSummary = Object.entries(sheets).map(([name, rows]) => {
        const headers = rows.length > 0 ? Object.keys(rows[0]) : []
        const sampleRows = rows.slice(0, 5)
        return `Sheet "${name}": ${rows.length} rows, columns: ${headers.join(', ')}
Sample data (first 5 rows):
${JSON.stringify(sampleRows, null, 2)}`
      }).join('\n\n')

      prompt = `Analyze this business data file and provide:
1. Data type identification (sales register, purchase register, inventory, expenses, etc.)
2. Column mapping suggestions (which columns map to: invoice number, date, party name, item name, quantity, rate, amount, tax, total, etc.)
3. Data quality issues (missing values, format inconsistencies, duplicates)
4. Import readiness assessment (can this data be directly imported into BizBook Pro?)
5. Suggested import actions (which modules to import into)

File: ${file.name}
Type: ${dataType.toUpperCase()}
${categoryInstruction}

${sheetSummary}

Provide a structured analysis in JSON format:
{
  "dataType": "sales|purchases|inventory|expenses|parties|unknown",
  "confidence": "high|medium|low",
  "columnMapping": { "originalColumn": "bizbookField" },
  "dataQuality": { "issues": [], "score": "0-100" },
  "importReady": true|false,
  "suggestions": [],
  "summary": "Brief summary"
}`
    } else if (dataType === 'image') {
      // For images, use vision AI
      prompt = `Analyze this business document/image and extract:
1. Document type (invoice, receipt, purchase order, etc.)
2. Key fields (invoice number, date, party name, items, amounts, tax)
3. Data quality and readability
4. Import suggestions

File: ${file.name}
${categoryInstruction}`
      imageBase64 = parsedData.base64
    } else {
      // For text/json/xml/pdf
      const content = typeof parsedData === 'string' ? parsedData : JSON.stringify(parsedData).substring(0, 10000)
      prompt = `Analyze this business data and provide:
1. Data type identification
2. Key information extraction
3. Import suggestions for BizBook Pro

File: ${file.name}
Type: ${dataType.toUpperCase()}
${categoryInstruction}
Content (first 10000 chars):
${content}

Provide a structured analysis with:
- dataType: what type of business data this is
- keyFields: important fields found
- suggestions: how to import this into BizBook Pro
- summary: brief summary`
    }

    // Call AI
    const { provider, result } = await analyzeWithAI(prompt, undefined, imageBase64)

    // Try to parse AI response as JSON, fallback to text
    try {
      analysis = JSON.parse(result)
      analysis._provider = provider
      analysis._rawResponse = result
    } catch {
      analysis = {
        dataType: 'unknown',
        confidence: 'low',
        summary: result,
        _provider: provider,
        _rawResponse: result,
      }
    }

    console.log(`[AI-Import] AI analysis complete. Provider: ${provider}`)
  } catch (aiError: any) {
    console.error('[AI-Import] AI analysis failed:', aiError)
    // Return parsed data without AI analysis (fallback)
    analysis = {
      dataType,
      confidence: 'low',
      summary: `File parsed successfully (${dataType}). AI analysis failed: ${aiError.message}. You can still review the raw data below.`,
      _aiError: aiError.message,
      _parsedData: true,
    }
  }

  // Return success with parsed data + AI analysis
  return NextResponse.json({
    success: true,
    fileName: file.name,
    fileSize,
    fileType: dataType,
    parsedData: dataType === 'image' ? undefined : parsedData, // Don't return base64 image data
    analysis,
    hasImageData: dataType === 'image',
    userCategory, // v6.19: Echo back the category the user selected
  })
}

// ============================================================
// Search Query Handler (legacy)
// ============================================================
async function handleSearchQuery(req: NextRequest) {
  const body = await req.json()
  const { tenantId, query, searchResults } = body

  const auth = await requireAuthAndTenant(req, tenantId)
  if (auth instanceof NextResponse) return auth

  if (!query) {
    return NextResponse.json({ error: 'No search query provided' }, { status: 400 })
  }

  // Search across modules
  const results: any[] = []

  if (!searchResults || searchResults.includes('sales')) {
    const sales = await db.sale.findMany({
      where: { tenantId, OR: [
        { invoiceNumber: { contains: query, mode: 'insensitive' } },
        { partyName: { contains: query, mode: 'insensitive' } },
      ]},
      take: 5,
      select: { id: true, invoiceNumber: true, partyName: true, totalAmount: true, createdAt: true },
    })
    results.push(...sales.map(s => ({ ...s, type: 'sale' })))
  }

  if (!searchResults || searchResults.includes('purchases')) {
    const purchases = await db.purchase.findMany({
      where: { tenantId, OR: [
        { invoiceNumber: { contains: query, mode: 'insensitive' } },
        { partyName: { contains: query, mode: 'insensitive' } },
      ]},
      take: 5,
      select: { id: true, invoiceNumber: true, partyName: true, totalAmount: true, createdAt: true },
    })
    results.push(...purchases.map(p => ({ ...p, type: 'purchase' })))
  }

  if (!searchResults || searchResults.includes('inventory')) {
    const items = await db.inventoryItem.findMany({
      where: { tenantId, name: { contains: query, mode: 'insensitive' } },
      take: 5,
      select: { id: true, name: true, sku: true, currentStock: true, salePrice: true },
    })
    results.push(...items.map(i => ({ ...i, type: 'inventory' })))
  }

  if (!searchResults || searchResults.includes('parties')) {
    const parties = await db.party.findMany({
      where: { tenantId, name: { contains: query, mode: 'insensitive' } },
      take: 5,
      select: { id: true, name: true, phone: true, gstNumber: true },
    })
    results.push(...parties.map(p => ({ ...p, type: 'party' })))
  }

  // AI Summary
  const prompt = `Search query: "${query}"
  Found these results:
  ${JSON.stringify(results.slice(0, 10), null, 2)}
  
  Provide a concise summary (2-3 sentences) of what was found.`;

  try {
    const { provider, result } = await analyzeWithAI(prompt)
    return NextResponse.json({ success: true, provider, summary: result, results: results.slice(0, 10), total: results.length })
  } catch {
    return NextResponse.json({ success: true, provider: 'fallback', summary: `Found ${results.length} results for "${query}"`, results: results.slice(0, 10), total: results.length })
  }
}
