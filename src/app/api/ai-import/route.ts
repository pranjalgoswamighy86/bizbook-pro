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
  const tenantId = formData.get('tenantId') as string
  // v6.27.5: Check for non-upload actions FIRST. The frontend sends FormData
  // with `action='apply'` or `action='export-excel'` (and NO file) to commit
  // the analyzed import data to the database / generate an Excel download.
  // Previously these were dead-lettered by the `if (!file)` guard below.
  const action = (formData.get('action') as string) || null
  if (action === 'apply') {
    return await handleApplyImport(req, formData, tenantId)
  }
  if (action === 'export-excel') {
    return await handleExportExcel(req, formData, tenantId)
  }

  const file = formData.get('file') as File
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
      // v6.27.5: PDF — extract real text with pdf-parse (was a placeholder before)
      try {
        const pdfParseModule: any = await import('pdf-parse')
        const pdfParse = pdfParseModule.default || pdfParseModule
        const pdfData = await pdfParse(buffer)
        parsedData = {
          content: pdfData.text || '',
          numpages: pdfData.numpages,
          info: pdfData.info,
        }
        dataType = 'pdf'
        console.log(`[AI-Import] Parsed PDF: ${pdfData.numpages} pages, ${pdfData.text?.length || 0} chars`)
        // If text extraction yielded nothing (scanned PDF), fall through to image-vision path
        // by treating the first page as an image. We mark dataType so the AI prompt builder
        // can route to vision.
        if (!pdfData.text || pdfData.text.trim().length < 20) {
          console.warn('[AI-Import] PDF text extraction yielded empty content (likely scanned). Falling back to vision AI.')
          // Convert first page to PNG via pdfjs-dist and feed to vision model.
          // Note: page rendering requires a canvas implementation. In the Next.js
          // server runtime we may not have node-canvas installed, so this is a
          // best-effort fallback. If it fails, the AI will receive the empty
          // content string and the user can convert to image manually.
          try {
            const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
            const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) })
            const pdfDoc = await loadingTask.promise
            const page = await pdfDoc.getPage(1)
            const viewport = page.getViewport({ scale: 2 })
            // Node-canvas fallback: render to a viewport and extract via canvas
            // In Next.js server runtime, use the offscreen canvas if available
            const Canvas = (global as any).canvas
            if (Canvas) {
              const ctx = Canvas.createCanvas(viewport.width, viewport.height)
              const renderContext: any = { canvasContext: ctx, viewport }
              await page.render(renderContext).promise
              const pngBuffer = ctx.toBuffer('image/png')
              parsedData = {
                content: '[Scanned PDF — rendered page 1 as image for vision analysis]',
                base64: `data:image/png;base64,${pngBuffer.toString('base64')}`,
                fileName: file.name,
              }
            }
          } catch (renderErr: any) {
            console.warn('[AI-Import] PDF page-render fallback failed:', renderErr?.message)
          }
        }
      } catch (pdfErr: any) {
        console.error('[AI-Import] pdf-parse failed:', pdfErr)
        // Last-resort fallback: send raw bytes info to AI
        parsedData = { content: `[PDF file: ${file.name}, ${fileSize} bytes. Text extraction failed: ${pdfErr.message}]`, note: 'PDF text extraction failed. Try converting to Excel/CSV.' }
        dataType = 'pdf'
      }
    } else if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(ext)) {
      // v6.27.5: Image file — convert to base64 data URL for vision analysis.
      // Pass the FULL data URL through to analyzeWithAI; multi-ai.ts now strips
      // the prefix correctly per provider (see multi-ai.ts v6.27.5 fix).
      const base64 = buffer.toString('base64')
      const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`
      parsedData = { base64: `data:${mimeType};base64,${base64}`, fileName: file.name, mimeType }
      dataType = 'image'
      console.log(`[AI-Import] Image file: ${fileSize} bytes, mime: ${mimeType}`)
    } else if (['xml'].includes(ext)) {
      // XML file (e.g., Tally export)
      const text = buffer.toString('utf-8')
      parsedData = { content: text.substring(0, 10000), note: 'XML file (Tally export or similar)' }
      dataType = 'xml'
      console.log(`[AI-Import] XML file: ${text.length} chars`)
    } else if (['docx', 'doc'].includes(ext)) {
      // v6.27.5: Word document — extract real text with mammoth (was a placeholder before)
      try {
        const mammoth = await import('mammoth')
        const result = await mammoth.extractRawText({ arrayBuffer })
        parsedData = { content: result.value || '', note: `Word document: ${file.name}` }
        dataType = 'doc'
        console.log(`[AI-Import] Parsed DOCX: ${result.value?.length || 0} chars`)
      } catch (docErr: any) {
        console.error('[AI-Import] mammoth failed:', docErr)
        parsedData = { content: `[Word document: ${file.name}, ${fileSize} bytes. Extraction failed: ${docErr.message}]`, note: 'Word document parsing failed.' }
        dataType = 'doc'
      }
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
      // v6.19.1: Truncate to avoid Gemini 400 errors on large files (303+ rows)
      const sheets = parsedData as Record<string, any[]>
      const MAX_ROWS_PER_SHEET = 30 // Truncate to 30 sample rows per sheet (was 5, but headers + 30 rows is safe for all providers)
      const MAX_TOTAL_CHARS = 20000 // Hard cap to stay under token limits
      const sheetSummary = Object.entries(sheets).map(([name, rows]) => {
        const headers = rows.length > 0 ? Object.keys(rows[0]) : []
        const sampleRows = rows.slice(0, MAX_ROWS_PER_SHEET)
        const truncatedNote = rows.length > MAX_ROWS_PER_SHEET ? `\n(Showing first ${MAX_ROWS_PER_SHEET} of ${rows.length} rows — data truncated for AI analysis)` : ''
        return `Sheet "${name}": ${rows.length} rows, columns: ${headers.join(', ')}${truncatedNote}
Sample data (first ${sampleRows.length} rows):
${JSON.stringify(sampleRows, null, 2)}`
      }).join('\n\n').substring(0, MAX_TOTAL_CHARS)

      prompt = `Analyze this business data file and extract records for import into BizBook Pro.

File: ${file.name}
Type: ${dataType.toUpperCase()}
${categoryInstruction}

${sheetSummary}

CRITICAL: You must return a JSON object with the following structure. The "importData" field is the MOST IMPORTANT — it contains the actual extracted records that will be imported. Extract ALL rows from the file, not just the sample.

Return EXACTLY this JSON structure (no markdown, no code fences, just pure JSON):
{
  "detectedDocumentType": "sale_invoice|purchase_invoice|bank_statement|inventory_data|expense_data|party_data|staff_data|backup_data|mixed_data|unknown",
  "detectedBusiness": "business name if found in the file, else null",
  "detectedGSTIN": "GSTIN if found, else null",
  "summary": "Brief 1-2 sentence summary of what was found",
  "confidence": 0.85,
  "importData": {
    "sales": [
      {
        "invoiceNumber": "string",
        "date": "YYYY-MM-DD or ISO date",
        "partyName": "customer name",
        "partyAddress": "string or null",
        "partyGst": "GSTIN or null",
        "items": [{"name":"item","qty":1,"rate":100,"amount":100,"total":100}],
        "subtotal": 100,
        "gstAmount": 0,
        "totalAmount": 100,
        "paymentStatus": "RECEIVED|PENDING|PARTIAL",
        "paymentMode": "CASH|UPI|CARD|OTHERS|null"
      }
    ],
    "purchases": [
      {
        "invoiceNumber": "string",
        "date": "YYYY-MM-DD",
        "partyName": "supplier name",
        "items": [{"name":"item","qty":1,"rate":100,"amount":100}],
        "subtotal": 100,
        "gstAmount": 0,
        "totalAmount": 100,
        "paymentStatus": "UNPAID|PAID|PARTIAL"
      }
    ],
    "expenses": [
      {"date":"YYYY-MM-DD","description":"string","amount":100,"category":"string","paymentMode":"CASH|UPI|CARD|BANK|OTHERS"}
    ],
    "products": [
      {"name":"item","hsnCode":"string|null","category":"string|null","unit":"PCS|KG|LTR","purchasePrice":0,"salePrice":0,"mrp":0,"currentStock":0,"gstRate":0}
    ],
    "parties": [
      {"name":"string","type":"CUSTOMER|SUPPLIER","address":"string|null","phone":"string|null","gstNumber":"string|null","currentBalance":0}
    ],
    "staff": [
      {"name":"string","role":"string","salary":0,"phone":"string|null"}
    ],
    "bankTransactions": [
      {"date":"YYYY-MM-DD","description":"string","deposit":0,"withdrawal":0,"balance":0,"category":"string|null","bankName":"string|null"}
    ]
  },
  "warnings": ["list of any data quality issues found"],
  "suggestions": ["list of import suggestions"]
}

RULES:
- Extract ALL rows from the file into the appropriate importData array(s), not just the sample.
- Only populate arrays that match the data you found. Leave empty arrays for modules with no data.
- Use 0 for missing numeric values, null for missing optional string values.
- Confidence is a number between 0 and 1 (e.g., 0.85 for 85% confident).
- If you cannot determine the document type, use "unknown" and put data in the most likely module.
- Do NOT wrap the JSON in markdown code fences. Return raw JSON only.`
    } else if (dataType === 'image' || (dataType === 'pdf' && parsedData?.base64)) {
      // v6.27.5: vision AI for images AND scanned PDFs that have been rendered to an image
      prompt = `Analyze this business document/image and extract:
1. Document type (invoice, receipt, purchase order, etc.)
2. Key fields (invoice number, date, party name, items, amounts, tax)
3. Data quality and readability
4. Import suggestions

Return a JSON object with this exact schema:
{
  "detectedDocumentType": "invoice|receipt|purchase|expense|unknown",
  "confidence": 0.85,
  "summary": "brief description of what you see",
  "importData": {
    "sales": [{"invoiceNumber":"string","date":"YYYY-MM-DD","partyName":"string","partyAddress":"string|null","partyGst":"string|null","items":[{"name":"item","qty":1,"rate":100,"amount":100,"total":100}],"subtotal":100,"gstAmount":0,"totalAmount":100,"paymentStatus":"RECEIVED|PENDING|PARTIAL","paymentMode":"CASH|UPI|CARD|OTHERS|null"}],
    "purchases": [{"invoiceNumber":"string","date":"YYYY-MM-DD","partyName":"string","items":[{"name":"item","qty":1,"rate":100,"amount":100}],"subtotal":100,"gstAmount":0,"totalAmount":100,"paymentStatus":"UNPAID|PAID|PARTIAL"}],
    "expenses": [{"date":"YYYY-MM-DD","description":"string","amount":100,"category":"string","paymentMode":"CASH|UPI|CARD|BANK|OTHERS"}],
    "products": [{"name":"item","hsnCode":"string|null","category":"string|null","unit":"PCS|KG|LTR","purchasePrice":0,"salePrice":0,"mrp":0,"currentStock":0,"gstRate":0}],
    "parties": [{"name":"string","type":"CUSTOMER|SUPPLIER","address":"string|null","phone":"string|null","gstNumber":"string|null","currentBalance":0}],
    "staff": [],
    "bankTransactions": []
  },
  "warnings": ["list of any data quality issues found"],
  "suggestions": ["list of import suggestions"]
}

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

    // v6.19.1: Clean the AI response — strip markdown code fences if present
    let cleanedResult = result.trim()
    if (cleanedResult.startsWith('```')) {
      // Remove ```json ... ``` or ``` ... ``` wrappers
      cleanedResult = cleanedResult.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    }

    // Try to parse AI response as JSON, fallback to text
    try {
      analysis = JSON.parse(cleanedResult)
      analysis._provider = provider
      analysis._rawResponse = result
      // v6.19.1: Ensure importData exists with all module arrays
      if (!analysis.importData) analysis.importData = {}
      const requiredModules = ['sales', 'purchases', 'expenses', 'products', 'parties', 'staff', 'bankTransactions']
      for (const mod of requiredModules) {
        if (!Array.isArray(analysis.importData[mod])) analysis.importData[mod] = []
      }
      // Ensure confidence is a number 0-1
      if (typeof analysis.confidence === 'string') {
        const c = analysis.confidence.toLowerCase()
        analysis.confidence = c === 'high' ? 0.9 : c === 'medium' ? 0.6 : c === 'low' ? 0.3 : 0.5
      } else if (typeof analysis.confidence === 'number' && analysis.confidence > 1) {
        // If confidence is 0-100, convert to 0-1
        analysis.confidence = analysis.confidence / 100
      } else if (typeof analysis.confidence !== 'number') {
        analysis.confidence = 0.5
      }
      console.log(`[AI-Import] AI analysis complete. Provider: ${provider}. Records: sales=${analysis.importData.sales.length}, purchases=${analysis.importData.purchases.length}, expenses=${analysis.importData.expenses.length}, products=${analysis.importData.products.length}`)
    } catch {
      analysis = {
        dataType: 'unknown',
        confidence: 0.3,
        summary: cleanedResult.substring(0, 500),
        _provider: provider,
        _rawResponse: result,
        importData: { sales: [], purchases: [], expenses: [], products: [], parties: [], staff: [], bankTransactions: [] },
        warnings: ['AI response could not be parsed as JSON. Showing raw summary.'],
        suggestions: [],
      }
    }

    console.log(`[AI-Import] AI analysis complete. Provider: ${provider}`)
  } catch (aiError: any) {
    console.error('[AI-Import] AI analysis failed:', aiError)
    // v6.27.5: Return a properly-shaped fallback so the frontend doesn't crash on
    // missing importData / non-numeric confidence. The user can still see the raw
    // parsed data via _parsedData and re-trigger analysis if needed.
    analysis = {
      dataType,
      detectedDocumentType: 'unknown',
      confidence: 0,
      summary: `File parsed (${dataType}) but AI analysis failed: ${aiError.message}. You can review the raw data below and try again.`,
      importData: { sales: [], purchases: [], expenses: [], products: [], parties: [], staff: [], bankTransactions: [] },
      warnings: [`AI analysis failed: ${aiError.message}`],
      suggestions: ['Try uploading a clearer file, or convert to Excel/CSV for better results.'],
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

// ============================================================
// v6.27.5: Apply Import Handler
// ============================================================
// Commits the AI-analyzed import data to the database. The frontend sends
// FormData with action='apply', tenantId, and importData (a JSON string with
// keys: sales, purchases, expenses, products, parties, staff, bankTransactions).
// Each array contains records to be created in the respective tables.
//
// Returns { success, results, message } where results is a per-module
// breakdown of { total, created, failed, errors[] }.
// ============================================================
async function handleApplyImport(req: NextRequest, formData: FormData, tenantId: string) {
  if (!tenantId) {
    return NextResponse.json({ error: 'No tenant ID provided' }, { status: 400 })
  }
  const auth = await requireAuthAndTenant(req, tenantId)
  if (auth instanceof NextResponse) return auth

  const importDataRaw = formData.get('importData') as string
  if (!importDataRaw) {
    return NextResponse.json({ error: 'No importData provided' }, { status: 400 })
  }

  let importData: any
  try {
    importData = JSON.parse(importDataRaw)
  } catch {
    return NextResponse.json({ error: 'importData is not valid JSON' }, { status: 400 })
  }

  const results: Record<string, { total: number; created: number; failed: number; errors: string[] }> = {}
  const tid = auth.tenantId

  // Helper to safely create records in bulk
  const bulkCreate = async (
    module: string,
    model: any,
    records: any[],
    buildRow: (r: any) => any
  ) => {
    results[module] = { total: records.length, created: 0, failed: 0, errors: [] }
    for (const rec of records) {
      try {
        const row = buildRow(rec)
        await model.create({ data: { ...row, tenantId: tid } })
        results[module].created++
      } catch (err: any) {
        results[module].failed++
        results[module].errors.push(`${err.message || err}`)
      }
    }
  }

  try {
    if (Array.isArray(importData.sales) && importData.sales.length > 0) {
      await bulkCreate('sales', db.sale, importData.sales, (s: any) => ({
        invoiceNumber: s.invoiceNumber || `IMP-${Date.now()}`,
        date: s.date ? new Date(s.date) : new Date(),
        partyName: s.partyName || 'Unknown',
        partyAddress: s.partyAddress || null,
        partyGst: s.partyGst || null,
        items: JSON.stringify(s.items || []),
        subtotal: Number(s.subtotal || 0),
        gstAmount: Number(s.gstAmount || 0),
        totalAmount: Number(s.totalAmount || 0),
        amountReceived: Number(s.amountReceived || s.amountPaid || 0),
        amountPaid: Number(s.amountPaid || s.amountReceived || 0),
        paymentStatus: s.paymentStatus || 'PENDING',
        paymentMode: s.paymentMode || null,
        invoiceStatus: 'INVOICE',
      }))
    }

    if (Array.isArray(importData.purchases) && importData.purchases.length > 0) {
      await bulkCreate('purchases', db.purchase, importData.purchases, (p: any) => ({
        invoiceNumber: p.invoiceNumber || `IMP-${Date.now()}`,
        date: p.date ? new Date(p.date) : new Date(),
        partyName: p.partyName || 'Unknown',
        items: JSON.stringify(p.items || []),
        subtotal: Number(p.subtotal || 0),
        gstAmount: Number(p.gstAmount || 0),
        totalAmount: Number(p.totalAmount || 0),
        amountPaid: Number(p.amountPaid || 0),
        paymentStatus: p.paymentStatus || 'UNPAID',
      }))
    }

    if (Array.isArray(importData.expenses) && importData.expenses.length > 0) {
      await bulkCreate('expenses', db.expense, importData.expenses, (e: any) => ({
        date: e.date ? new Date(e.date) : new Date(),
        description: e.description || 'Imported expense',
        amount: Number(e.amount || 0),
        category: e.category || 'General',
        paymentMode: e.paymentMode || 'OTHERS',
      }))
    }

    if (Array.isArray(importData.products) && importData.products.length > 0) {
      await bulkCreate('products', db.inventoryItem, importData.products, (p: any) => ({
        name: p.name || 'Unnamed Product',
        hsnCode: p.hsnCode || null,
        category: p.category || null,
        unit: p.unit || 'PCS',
        purchasePrice: Number(p.purchasePrice || 0),
        salePrice: Number(p.salePrice || 0),
        mrp: Number(p.mrp || 0),
        currentStock: Number(p.currentStock || 0),
        gstRate: Number(p.gstRate || 0),
        value: Number(p.currentStock || 0) * Number(p.purchasePrice || 0),
      }))
    }

    if (Array.isArray(importData.parties) && importData.parties.length > 0) {
      await bulkCreate('parties', db.party, importData.parties, (p: any) => ({
        name: p.name || 'Unnamed Party',
        type: p.type || 'CUSTOMER',
        address: p.address || null,
        phone: p.phone || null,
        gstNumber: p.gstNumber || null,
        currentBalance: Number(p.currentBalance || 0),
      }))
    }

    if (Array.isArray(importData.staff) && importData.staff.length > 0) {
      await bulkCreate('staff', db.staff, importData.staff, (s: any) => ({
        name: s.name || 'Unnamed Staff',
        role: s.role || 'Staff',
        salary: Number(s.salary || 0),
        phone: s.phone || null,
      }))
    }

    if (Array.isArray(importData.bankTransactions) && importData.bankTransactions.length > 0) {
      await bulkCreate('bankTransactions', db.bankTransaction, importData.bankTransactions, (b: any) => ({
        date: b.date ? new Date(b.date) : new Date(),
        description: b.description || 'Imported transaction',
        deposit: Number(b.deposit || 0),
        withdrawal: Number(b.withdrawal || 0),
        balance: Number(b.balance || 0),
        category: b.category || null,
        bankName: b.bankName || null,
      }))
    }

    const totalCreated = Object.values(results).reduce((sum, r) => sum + r.created, 0)
    const totalFailed = Object.values(results).reduce((sum, r) => sum + r.failed, 0)
    const message = totalFailed === 0
      ? `Successfully imported ${totalCreated} record(s).`
      : `Imported ${totalCreated} record(s) with ${totalFailed} failure(s).`

    return NextResponse.json({ success: true, results, message })
  } catch (err: any) {
    console.error('[AI-Import] apply failed:', err)
    return NextResponse.json({ error: `Import failed: ${err.message}`, results }, { status: 500 })
  }
}

// ============================================================
// v6.27.5: Export to Excel Handler
// ============================================================
// Generates an .xlsx file from the AI-analyzed import data and returns it
// as a downloadable blob. The frontend sends FormData with action='export-excel',
// tenantId, and importData (a JSON string).
// ============================================================
async function handleExportExcel(req: NextRequest, formData: FormData, tenantId: string) {
  if (!tenantId) {
    return NextResponse.json({ error: 'No tenant ID provided' }, { status: 400 })
  }
  const auth = await requireAuthAndTenant(req, tenantId)
  if (auth instanceof NextResponse) return auth

  const importDataRaw = formData.get('importData') as string
  if (!importDataRaw) {
    return NextResponse.json({ error: 'No importData provided' }, { status: 400 })
  }

  let importData: any
  try {
    importData = JSON.parse(importDataRaw)
  } catch {
    return NextResponse.json({ error: 'importData is not valid JSON' }, { status: 400 })
  }

  try {
    const XLSX = await import('xlsx')
    const workbook = XLSX.utils.book_new()

    const moduleSheets: Record<string, string> = {
      sales: 'Sales',
      purchases: 'Purchases',
      expenses: 'Expenses',
      products: 'Products',
      parties: 'Parties',
      staff: 'Staff',
      bankTransactions: 'Bank Transactions',
    }

    for (const [key, sheetName] of Object.entries(moduleSheets)) {
      const rows = Array.isArray(importData[key]) ? importData[key] : []
      if (rows.length === 0) continue
      const worksheet = XLSX.utils.json_to_sheet(rows)
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
    }

    // If no sheets were added, add an empty "No Data" sheet
    if (workbook.SheetNames.length === 0) {
      const ws = XLSX.utils.aoa_to_sheet([['No data to export']])
      XLSX.utils.book_append_sheet(workbook, ws, 'No Data')
    }

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    const filename = `BizBook_AI_Import_${new Date().toISOString().slice(0, 10)}.xlsx`

    return new NextResponse(buffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: any) {
    console.error('[AI-Import] export-excel failed:', err)
    return NextResponse.json({ error: `Excel export failed: ${err.message}` }, { status: 500 })
  }
}
