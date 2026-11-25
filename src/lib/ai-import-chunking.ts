export interface SpreadsheetSourceRow {
  sheet: string
  row: number
}

export interface SpreadsheetBatch {
  id: string
  summary: string
  sourceRows: SpreadsheetSourceRow[]
}

export interface SpreadsheetBatchOptions {
  maxRows?: number
  maxChars?: number
}

const DEFAULT_MAX_ROWS = 15
const DEFAULT_MAX_CHARS = 14000

/**
 * Split every parsed spreadsheet row into bounded, independently analyzable
 * batches. Source row numbers are 1-based and include the header row.
 */
export function chunkSpreadsheetRows(
  sheets: Record<string, Array<Record<string, unknown>>>,
  options: SpreadsheetBatchOptions = {},
): SpreadsheetBatch[] {
  const maxRows = Math.max(1, options.maxRows ?? DEFAULT_MAX_ROWS)
  const maxChars = Math.max(1000, options.maxChars ?? DEFAULT_MAX_CHARS)
  const batches: SpreadsheetBatch[] = []
  let pending: Array<{ source: SpreadsheetSourceRow; value: Record<string, unknown>; serialized: string }> = []
  let pendingChars = 0

  const flush = () => {
    if (pending.length === 0) return
    const sheetNames = Array.from(new Set(pending.map(item => item.source.sheet)))
    const sections = sheetNames.map(sheet => {
      const rows = pending.filter(item => item.source.sheet === sheet)
      const headers = rows.length ? Object.keys(rows[0].value) : []
      return [
        `Sheet "${sheet}" — ${rows.length} supplied source row(s); columns: ${headers.join(', ')}`,
        JSON.stringify(rows.map(item => ({ ...item.value, __bizbookSource: item.source }))),
      ].join('\n')
    })
    batches.push({
      id: `batch-${batches.length + 1}`,
      summary: sections.join('\n\n'),
      sourceRows: pending.map(item => item.source),
    })
    pending = []
    pendingChars = 0
  }

  for (const [sheet, rows] of Object.entries(sheets)) {
    for (let index = 0; index < rows.length; index++) {
      const source = { sheet, row: index + 2 }
      const value = rows[index] || {}
      const serialized = JSON.stringify({ ...value, __bizbookSource: source })
      // A single exceptionally wide row is kept intact in its own batch. It
      // is never silently sliced; the API's upload-size limit bounds exposure.
      const separatorChars = pending.length ? 1 : 0
      if (pending.length && (pending.length >= maxRows || pendingChars + serialized.length + separatorChars > maxChars)) flush()
      pending.push({ source, value, serialized })
      pendingChars += serialized.length + separatorChars
      if (pending.length >= maxRows) flush()
    }
  }
  flush()
  return batches
}

export type SourceRowStatus = 'extracted' | 'ignored' | 'ambiguous'

export interface SourceRowResult extends SpreadsheetSourceRow {
  status: SourceRowStatus
  reason?: string
}

/** Compare expected rows with model-reported row outcomes without guessing. */
export function reconcileSourceRows(
  batches: SpreadsheetBatch[],
  outcomes: SourceRowResult[],
): { expected: number; accounted: number; ambiguous: number; missing: SpreadsheetSourceRow[]; invalid: SourceRowResult[] } {
  const expected = new Set(batches.flatMap(batch => batch.sourceRows.map(row => `${row.sheet}\u0000${row.row}`)))
  const accounted = new Set<string>()
  const invalid: SourceRowResult[] = []
  for (const outcome of outcomes) {
    const key = `${outcome.sheet}\u0000${outcome.row}`
    if (!expected.has(key) || !['extracted', 'ignored', 'ambiguous'].includes(outcome.status)) {
      invalid.push(outcome)
      continue
    }
    accounted.add(key)
  }
  const missing = batches.flatMap(batch => batch.sourceRows).filter(row => !accounted.has(`${row.sheet}\u0000${row.row}`))
  const ambiguous = outcomes.filter(outcome => outcome.status === 'ambiguous' && expected.has(`${outcome.sheet}\u0000${outcome.row}`)).length
  return { expected: expected.size, accounted: accounted.size, ambiguous, missing, invalid }
}

/** Merge model outputs, de-duplicating only when the model supplied source IDs. */
export function mergeSpreadsheetImportData(
  results: Array<Record<string, unknown>>,
  moduleKeys: string[],
): Record<string, unknown[]> {
  const merged: Record<string, unknown[]> = Object.fromEntries(moduleKeys.map(key => [key, []]))
  const seen = new Set<string>()
  for (const result of results) {
    const importData = result.importData && typeof result.importData === 'object'
      ? result.importData as Record<string, unknown>
      : {}
    for (const key of moduleKeys) {
      const records = Array.isArray(importData[key]) ? importData[key] as Array<Record<string, unknown>> : []
      for (const record of records) {
        const sourceRows = Array.isArray(record?._sourceRows) ? record._sourceRows : null
        const identity = sourceRows?.length
          ? `${key}:${JSON.stringify(sourceRows.slice().sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b))))}`
          : null
        if (identity && seen.has(identity)) continue
        if (identity) seen.add(identity)
        merged[key].push(record)
      }
    }
  }
  return merged
}
