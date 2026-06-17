import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db-soft-delete'
import { writeFile, mkdir, unlink, readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { requireAuthAndTenant, requireAuthAndRole, requireAuth, writeAuditLog } from '@/lib/api-helpers'

const UPLOAD_DIR = join(process.cwd(), 'uploaded-invoices')

// Ensure upload directory exists
async function ensureUploadDir() {
  await mkdir(UPLOAD_DIR, { recursive: true })
}

// Save base64 file to disk and return the file path
async function saveInvoiceFile(base64DataUrl: string, invoiceNumber?: string): Promise<string> {
  await ensureUploadDir()
  const match = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) throw new Error('Invalid data URL format')

  const mimeType = match[1]
  const base64 = match[2]
  const isPdf = mimeType === 'application/pdf'
  const ext = isPdf ? 'pdf' : (mimeType.split('/')[1] || 'png')
  const prefix = invoiceNumber ? invoiceNumber.replace(/[^a-zA-Z0-9]/g, '_') : 'INV'
  const fileName = `${prefix}_${Date.now()}.${ext}`
  const filePath = join(UPLOAD_DIR, fileName)

  const buffer = Buffer.from(base64, 'base64')
  await writeFile(filePath, buffer)

  return fileName
}

// Convert PDF to PNG images using pdftoppm
async function convertPdfToImages(pdfBase64: string): Promise<string[]> {
  const tempDir = join(process.cwd(), 'temp')
  await mkdir(tempDir, { recursive: true })

  const tempId = randomUUID()
  const pdfPath = join(tempDir, `${tempId}.pdf`)

  try {
    const pdfBuffer = Buffer.from(pdfBase64, 'base64')
    await writeFile(pdfPath, pdfBuffer)

    const outputPrefix = join(tempDir, `${tempId}_page`)

    await new Promise<void>((resolve, reject) => {
      const proc = execFile('pdftoppm', ['-png', '-r', '200', '-l', '3', pdfPath, outputPrefix], (error) => {
        if (error) {
          reject(new Error(`PDF conversion failed: ${error.message}`))
        } else {
          resolve()
        }
      })
      setTimeout(() => {
        proc.kill()
        reject(new Error('PDF conversion timed out after 30s'))
      }, 30000)
    })

    const files = await readdir(tempDir)
    const pngFiles = files
      .filter(f => f.startsWith(`${tempId}_page`) && f.endsWith('.png'))
      .sort()
      .map(f => join(tempDir, f))

    if (pngFiles.length === 0) {
      throw new Error('No pages generated from PDF')
    }

    const imageDataUrls: string[] = []
    for (const pngPath of pngFiles.slice(0, 3)) {
      const imgBuffer = await readFile(pngPath)
      const base64 = imgBuffer.toString('base64')
      imageDataUrls.push(`data:image/png;base64,${base64}`)
      try { await unlink(pngPath) } catch {}
    }

    return imageDataUrls
  } finally {
    try { await unlink(pdfPath) } catch {}
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { invoiceImage, tenantId, autoSave, fileType } = body

    if (!invoiceImage) {
      return NextResponse.json({ error: 'No invoice file provided' }, { status: 400 })
    }

    const isPdf = invoiceImage.startsWith('data:application/pdf') || fileType === 'pdf'
    const zai = await ZAI.create()

    let contentItems: Array<Record<string, unknown>> = []
    let usedMethod = 'image'

    if (isPdf) {
      const base64Match = invoiceImage.match(/^data:application\/pdf;base64,(.+)$/)
      if (!base64Match) {
        return NextResponse.json({
          error: 'Invalid PDF file format. Please upload a valid PDF or take a screenshot of the invoice.'
        }, { status: 400 })
      }

      // STRATEGY 1: Try file_url content type
      try {
        contentItems = [{
          type: 'file_url',
          file_url: { url: invoiceImage }
        }]
        usedMethod = 'file_url'

        const testResponse = await zai.chat.completions.createVision({
          model: 'glm-4v-flash',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Is this a valid invoice? Reply with just YES or NO.' },
                ...contentItems
              ]
            }
          ],
          thinking: { type: 'disabled' }
        })

        const testContent = testResponse.choices[0]?.message?.content || ''
        if (!testContent || testContent.includes('error') || testContent.includes('cannot')) {
          throw new Error('file_url not supported, falling back to image conversion')
        }

        console.log('[analyze-invoice] file_url approach accepted by VLM')
      } catch (fileUrlError) {
        // STRATEGY 2: Fallback - convert PDF to PNG images
        console.log('[analyze-invoice] file_url failed, converting PDF to images:', fileUrlError instanceof Error ? fileUrlError.message : 'unknown error')
        usedMethod = 'image_conversion'

        try {
          const pageImages = await convertPdfToImages(base64Match[1])
          contentItems = pageImages.map(imgUrl => ({
            type: 'image_url',
            image_url: { url: imgUrl }
          }))
          console.log(`[analyze-invoice] Converted PDF to ${pageImages.length} image(s)`)
        } catch (conversionError) {
          console.error('[analyze-invoice] PDF conversion also failed:', conversionError instanceof Error ? conversionError.message : 'unknown error')
          return NextResponse.json({
            error: 'Could not process PDF file. Please try uploading a screenshot/image of the invoice instead.',
            details: conversionError instanceof Error ? conversionError.message : 'PDF conversion failed'
          }, { status: 400 })
        }
      }
    } else {
      contentItems.push({
        type: 'image_url',
        image_url: { url: invoiceImage }
      })
    }

    console.log(`[analyze-invoice] Analyzing with method: ${usedMethod}, content items: ${contentItems.length}`)

    const response = await zai.chat.completions.createVision({
      model: 'glm-4v-flash',
      messages: [
        {
          role: 'system',
          content: `You are an expert GST invoice analyzer for Indian businesses. Your ONLY job is to READ and EXTRACT data exactly as printed on the invoice. NEVER calculate, estimate, or guess any numbers.

CRITICAL RULES:
1. READ numbers from the invoice image. Do NOT calculate them. If you see "59,455.00" on the invoice, output 59455.00 — do NOT add tax to it or modify it.
2. The subtotal, totalTax, and totalAmount fields are the MOST IMPORTANT — they are the invoice's printed totals.
3. Look for the SUMMARY/TOTAL section of the invoice. It typically shows: Taxable Amount / Sub Total, Total Tax (CGST + SGST or IGST), and Grand Total / Bill Total.
4. Per-item GST rates: ONLY set gstPercent if you can SEE the actual percentage printed on the invoice (like "5%", "12%", "18%"). If the percentage is NOT printed, set gstPercent to 0.
5. Per-item taxAmount: ONLY set this if you can SEE the actual tax amount for each item in a column. If not visible, set to 0.
6. The "rate" field should be the tax-exclusive per-unit rate. If the invoice shows "Rate (Incl. of Tax)", calculate: taxExclusiveRate = taxableAmount / qty.

GST RULES FOR INDIAN INVOICES:
- GST rates vary: 0% (exempt), 5%, 12%, 18%, 28%
- Within a state: CGST + SGST (e.g., 2.5% CGST + 2.5% SGST = 5% total)
- Between states: IGST alone (e.g., 5% IGST = 5% total)
- gstPercent = total GST (CGST% + SGST% or IGST%)

IMPORTANT: Extract the SUMMARY totals from the bottom of the invoice. These override any per-item calculations.

Return ONLY valid JSON with this EXACT structure (no markdown, no code blocks):
{
  "invoiceNumber": "bill/invoice number as string",
  "date": "YYYY-MM-DD",
  "supplierName": "supplier/vendor name",
  "supplierAddress": "full address",
  "supplierGST": "GSTIN",
  "subtotal": TAXABLE_AMOUNT_FROM_INVOICE_SUMMARY,
  "totalTax": TOTAL_TAX_FROM_INVOICE_SUMMARY,
  "totalAmount": GRAND_TOTAL_FROM_INVOICE_SUMMARY,
  "items": [
    {
      "name": "item description",
      "category": "category or empty string",
      "hsn": "HSN/SAC code or empty string",
      "unit": "PCS, KGS, PKT, LTR, NOS, MTR etc",
      "qty": quantity,
      "rate": tax_exclusive_rate_per_unit,
      "gstPercent": total_GST_percent_ONLY_IF_VISIBLE_otherwise_0,
      "taxAmount": per_item_tax_ONLY_IF_VISIBLE_otherwise_0,
      "mrp": MRP_or_0,
      "discount": discount_or_0
    }
  ]
}

Use empty string for unknown strings, 0 for unknown numbers.
Return ONLY the JSON. No markdown, no code blocks, no explanation.`
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Read this invoice carefully. I need you to:\n1. Find the INVOICE SUMMARY section at the bottom — extract the exact Sub Total, Total Tax, and Grand Total numbers printed there.\n2. Do NOT calculate or change these numbers — copy them EXACTLY as printed.\n3. For each item, only set gstPercent if the actual % is printed on the invoice. If not visible, use 0.\n4. For each item, only set taxAmount if the actual tax amount is printed per item. If not visible, use 0.\n5. Return structured JSON only.'
            },
            ...contentItems
          ]
        }
      ],
      thinking: { type: 'disabled' }
    })

    const content = response.choices[0]?.message?.content || ''
    console.log('[analyze-invoice] VLM response length:', content.length, 'first 300 chars:', content.substring(0, 300))

    // Try to parse the JSON from the response
    let analysis
    try {
      let jsonStr = content.trim()
      const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim()
      }
      analysis = JSON.parse(jsonStr)
    } catch (firstError) {
      try {
        const jsonObjectMatch = content.match(/\{[\s\S]*\}/)
        if (jsonObjectMatch) {
          analysis = JSON.parse(jsonObjectMatch[0])
        }
      } catch (secondError) {
        console.error('[analyze-invoice] JSON parse failed. Raw content:', content.substring(0, 500))
        return NextResponse.json({
          analysis: null,
          rawContent: content,
          error: 'Could not parse invoice data. AI response was not valid JSON. Please fill manually.'
        })
      }
    }

    if (!analysis) {
      return NextResponse.json({
        analysis: null,
        rawContent: content,
        error: 'No data extracted from invoice. Please fill manually.'
      })
    }

    // Validate minimum required fields
    if (!analysis.items || !Array.isArray(analysis.items) || analysis.items.length === 0) {
      return NextResponse.json({
        analysis: null,
        rawContent: content,
        error: 'No items found in the invoice. Please fill manually.'
      })
    }

    // Normalize field names - VLM may return alternate field names
    analysis.items = analysis.items.map((item: Record<string, unknown>) => ({
      name: item.name || item.description || item.itemName || item.product || '',
      category: item.category || item.type || '',
      hsn: item.hsn || item.hsnCode || item.sac || '',
      unit: item.unit || item.uom || 'PCS',
      qty: Number(item.qty || item.quantity || item.qtySold || 1),
      rate: Number(item.rate || item.unitPrice || item.price || item.ratePerUnit || 0),
      gstPercent: Number(item.gstPercent || item.gstPercentage || item.gstRate || item.taxPercent || item.taxRate || 0),
      taxAmount: Number(item.taxAmount || item.tax || item.gstAmount || 0),
      mrp: Number(item.mrp || item.maximumRetailPrice || 0),
      discount: Number(item.discount || item.discountAmount || 0),
    }))

    // Normalize top-level fields
    analysis.invoiceNumber = analysis.invoiceNumber || analysis.invoiceNo || analysis.billNumber || ''
    analysis.supplierName = analysis.supplierName || analysis.vendorName || analysis.sellerName || analysis.partyName || ''
    analysis.supplierAddress = analysis.supplierAddress || analysis.vendorAddress || analysis.address || ''
    analysis.supplierGST = analysis.supplierGST || analysis.vendorGST || analysis.gstin || ''

    // ===== INVOICE TOTAL RECONCILIATION =====
    // Use the invoice's printed totals as the AUTHORITATIVE source
    const invoiceSubtotal = Number(analysis.subtotal || analysis.taxableAmount || analysis.subTotal || 0)
    const invoiceTotalTax = Number(analysis.totalTax || analysis.totalTaxAmount || analysis.totalGst || 0)
    const invoiceGrandTotal = Number(analysis.totalAmount || analysis.grandTotal || analysis.billTotal || 0)

    // Calculate item-level base amounts from extracted data
    const itemBaseAmounts = analysis.items.map((item: any) => {
      return (item.qty || 0) * (item.rate || 0) - (item.discount || 0)
    })
    const calculatedSubtotal = itemBaseAmounts.reduce((sum: number, amt: number) => sum + amt, 0)

    // Calculate VLM-extracted per-item tax amounts
    const vlmItemTaxes = analysis.items.map((item: any) => item.taxAmount || 0)
    const vlmTotalTax = vlmItemTaxes.reduce((sum: number, amt: number) => sum + amt, 0)

    // Also calculate tax using VLM-extracted gstPercent values
    const vlmPercentTaxes = analysis.items.map((item: any, idx: number) => {
      return itemBaseAmounts[idx] * ((item.gstPercent || 0) / 100)
    })
    const vlmPercentTotalTax = vlmPercentTaxes.reduce((sum: number, amt: number) => sum + amt, 0)

    console.log(`[analyze-invoice] Invoice totals — Subtotal: ₹${invoiceSubtotal}, Tax: ₹${invoiceTotalTax}, Grand Total: ₹${invoiceGrandTotal}`)
    console.log(`[analyze-invoice] Calculated item subtotal: ₹${Math.round(calculatedSubtotal * 100) / 100}`)
    console.log(`[analyze-invoice] VLM per-item tax amounts total: ₹${Math.round(vlmTotalTax * 100) / 100}`)
    console.log(`[analyze-invoice] VLM gstPercent-derived tax total: ₹${Math.round(vlmPercentTotalTax * 100) / 100}`)

    // ===== DECISION LOGIC: Which tax values to trust? =====
    // The invoice's printed total tax is ALWAYS the most authoritative source.
    // VLM per-item tax amounts and gstPercent are OFTEN WRONG (hallucinated rates).
    // We will ALWAYS reconcile against the invoice total tax.

    if (invoiceTotalTax > 0) {
      // We have the authoritative total tax from the invoice.
      // ALWAYS distribute it proportionally across items — this ensures the sum matches exactly.
      const effectiveTaxRate = calculatedSubtotal > 0 ? invoiceTotalTax / calculatedSubtotal : 0
      console.log(`[analyze-invoice] Using invoice total tax ₹${invoiceTotalTax} as authority. Effective rate: ${(effectiveTaxRate * 100).toFixed(2)}%`)

      analysis.items = analysis.items.map((item: any, idx: number) => {
        const baseAmount = itemBaseAmounts[idx]
        const proportionalTax = baseAmount * effectiveTaxRate
        return {
          ...item,
          gstPercent: Math.round(effectiveTaxRate * 10000) / 100, // Total GST % (CGST+SGST or IGST)
          taxAmount: Math.round(proportionalTax * 100) / 100,
        }
      })
    } else {
      // No invoice total tax available — fall back to per-item values
      // But check if per-item tax amounts vs gstPercent give different results
      const hasItemTaxAmounts = analysis.items.some((item: any) => item.taxAmount > 0)

      if (hasItemTaxAmounts) {
        // Use per-item tax amounts as-is
        analysis.items = analysis.items.map((item: any, idx: number) => {
          const baseAmount = itemBaseAmounts[idx]
          const taxAmt = item.taxAmount || 0
          return {
            ...item,
            taxAmount: Math.round(taxAmt * 100) / 100,
            gstPercent: item.gstPercent > 0 ? item.gstPercent : (baseAmount > 0 ? Math.round((taxAmt / baseAmount) * 10000) / 100 : 0),
          }
        })
      } else if (vlmPercentTotalTax > 0) {
        // Only gstPercent values available — calculate tax from them
        analysis.items = analysis.items.map((item: any, idx: number) => {
          const baseAmount = itemBaseAmounts[idx]
          const taxAmt = baseAmount * ((item.gstPercent || 0) / 100)
          return {
            ...item,
            taxAmount: Math.round(taxAmt * 100) / 100,
          }
        })
      } else {
        // No tax information at all — set all to 0
        analysis.items = analysis.items.map((item: any) => ({
          ...item,
          gstPercent: 0,
          taxAmount: 0,
        }))
      }
    }

    // ===== FINAL RECONCILIATION: Verify calculated totals match invoice totals =====
    const finalItemTaxes = analysis.items.map((item: any) => item.taxAmount || 0)
    const finalTotalTax = finalItemTaxes.reduce((sum: number, amt: number) => sum + amt, 0)
    const finalSubtotal = analysis.items.reduce((sum: number, item: any) => sum + ((item.qty || 0) * (item.rate || 0) - (item.discount || 0)), 0)

    // Store the authoritative invoice totals in the analysis
    analysis.subtotal = invoiceSubtotal || Math.round(finalSubtotal * 100) / 100
    analysis.totalTax = invoiceTotalTax || Math.round(finalTotalTax * 100) / 100
    analysis.totalAmount = invoiceGrandTotal || Math.round((analysis.subtotal + analysis.totalTax) * 100) / 100

    console.log(`[analyze-invoice] Final totals — Subtotal: ₹${analysis.subtotal}, Tax: ₹${analysis.totalTax}, Grand Total: ₹${analysis.totalAmount}`)
    console.log(`[analyze-invoice] Final item tax sum: ₹${Math.round(finalTotalTax * 100) / 100}, Invoice tax: ₹${invoiceTotalTax}, Match: ${Math.abs(finalTotalTax - invoiceTotalTax) < 1}`)

    // Save invoice file to disk
    let invoiceFileName: string | null = null
    try {
      invoiceFileName = await saveInvoiceFile(invoiceImage, analysis.invoiceNumber || undefined)
      console.log('[analyze-invoice] Saved invoice file:', invoiceFileName)
    } catch (saveFileError) {
      console.error('[analyze-invoice] Failed to save invoice file to disk:', saveFileError)
    }

    // ===== AUTO-SAVE MODE =====
    if (autoSave && tenantId && analysis) {
      try {
        const items = (analysis.items || []).map((item: {
          name: string; category?: string; hsn?: string; unit?: string;
          qty?: number; rate?: number; gstPercent?: number; taxAmount?: number;
          mrp?: number; discount?: number;
        }) => {
          const qty = item.qty || 1
          const rate = item.rate || 0
          const discount = item.discount || 0
          const gstPercent = item.gstPercent || 0
          const baseAmount = qty * rate - discount
          // Use extracted taxAmount if available, otherwise calculate from gstPercent
          const taxAmt = (item.taxAmount && item.taxAmount > 0)
            ? item.taxAmount
            : baseAmount * (gstPercent / 100)

          return {
            name: item.name || '',
            category: item.category || '',
            hsn: item.hsn || '',
            unit: item.unit || 'PCS',
            qty,
            rate,
            taxes: [{ name: 'GST', percent: gstPercent, percentOn: 'Amount', amount: Math.round(taxAmt * 100) / 100 }],
            mrp: item.mrp || 0,
            discount,
            amount: Math.round(baseAmount * 100) / 100,
            totalTax: Math.round(taxAmt * 100) / 100,
            total: Math.round((baseAmount + taxAmt) * 100) / 100,
          }
        })

        // Use INVOICE PRINTED TOTALS for the purchase record (not recalculated)
        const subtotal = analysis.subtotal || items.reduce((s: number, i: any) => s + i.amount, 0)
        const gstAmount = analysis.totalTax || items.reduce((s: number, i: any) => s + i.totalTax, 0)
        const totalAmount = analysis.totalAmount || (subtotal + gstAmount)

        const purchase = await db.purchase.create({
          data: {
            tenantId,
            invoiceNumber: analysis.invoiceNumber || `PUR-${Date.now().toString().slice(-6)}`,
            date: analysis.date ? new Date(analysis.date).toISOString() : new Date().toISOString(),
            partyName: analysis.supplierName || 'Unknown Supplier',
            partyAddress: analysis.supplierAddress || null,
            partyGst: analysis.supplierGST || null,
            items: JSON.stringify(items),
            subtotal,
            gstAmount,
            totalAmount,
            paymentStatus: 'PENDING',
            amountPaid: 0,
            notes: 'Auto-created from AI invoice analysis',
            invoiceFile: invoiceFileName,
          }
        })

        // Auto inventory update
        const inventoryUpdates: string[] = []
        for (const item of items) {
          if (!item.name || !item.qty || item.qty <= 0) continue

          const allItems = await db.inventoryItem.findMany({ where: { tenantId } })
          const existingItem = allItems.find(i =>
            i.name.toLowerCase() === item.name.toLowerCase() ||
            (item.hsn && i.hsnCode === item.hsn)
          )

          if (existingItem) {
            const newStock = existingItem.currentStock + item.qty
            await db.inventoryItem.update({
              where: { id: existingItem.id },
              data: {
                currentStock: newStock,
                value: newStock * (item.rate || existingItem.purchasePrice),
                purchasePrice: item.rate || existingItem.purchasePrice,
                ...(item.category && !existingItem.category ? { category: item.category } : {}),
                ...(item.hsn && !existingItem.hsnCode ? { hsnCode: item.hsn } : {}),
                ...(item.mrp && (!existingItem.mrp || existingItem.mrp === 0) ? { mrp: item.mrp } : {}),
              }
            })
            inventoryUpdates.push(`${item.name}: +${item.qty} ${item.unit} (now ${newStock})`)
          } else {
            await db.inventoryItem.create({
              data: {
                tenantId,
                name: item.name,
                category: item.category || null,
                hsnCode: item.hsn || null,
                unit: item.unit || 'PCS',
                purchasePrice: item.rate || 0,
                salePrice: 0,
                mrp: item.mrp || null,
                openingStock: 0,
                currentStock: item.qty || 0,
                minStock: 0,
                gstRate: item.taxes && item.taxes.length > 0 ? item.taxes[0].percent : 0,
                value: (item.qty || 0) * (item.rate || 0),
              }
            })
            inventoryUpdates.push(`${item.name}: created with ${item.qty} ${item.unit}`)
          }
        }

        return NextResponse.json({
          analysis,
          autoSaved: true,
          purchaseId: purchase.id,
          invoiceNumber: purchase.invoiceNumber,
          invoiceFileName,
          inventoryUpdates,
          message: `Purchase ${purchase.invoiceNumber} created & ${inventoryUpdates.length} inventory item(s) updated`
        })
      } catch (saveError) {
        console.error('[analyze-invoice] Auto-save error:', saveError)
        return NextResponse.json({
          analysis,
          autoSaved: false,
          invoiceFileName,
          error: 'Analysis complete but auto-save failed. Please save manually.'
        })
      }
    }

    // Default: return analysis for form auto-population (no auto-save)
    return NextResponse.json({ analysis, autoSaved: false, invoiceFileName })
  } catch (error) {
    console.error('[analyze-invoice] Invoice analysis error:', error)
    return NextResponse.json({
      error: 'Invoice analysis failed. Please check the file and try again.',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
