/**
 * Excel export utility - separated from formulas.ts to avoid bundling
 * the xlsx library (~800KB) into the main client chunk.
 * Only imports xlsx when exportToExcel is actually called.
 */

export async function exportToExcel(data: Record<string, unknown>[], filename: string, sheetName: string = 'Sheet1') {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)

  // Auto-fit column widths
  const colWidths = Object.keys(data[0] || {}).map((key) => {
    const maxLen = Math.max(
      key.length,
      ...data.map((row) => String(row[key] ?? '').length)
    )
    return { wch: Math.min(maxLen + 2, 40) }
  })
  ws['!cols'] = colWidths

  XLSX.writeFile(wb, `${filename}.xlsx`)
}
