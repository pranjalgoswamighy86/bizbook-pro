'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useAppStore } from '@/store/app-store'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  FileSpreadsheet, Upload, Loader2, CheckCircle2, AlertTriangle,
  Sparkles, ShoppingCart, Package, Receipt, Users, Banknote,
  X, FolderOpen
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

type DetectedDocumentType = 'sale_invoice' | 'purchase_invoice' | 'bank_statement' | 'inventory_data' | 'expense_data' | 'staff_data' | 'party_data' | 'backup_data' | 'mixed_data' | 'unknown'

interface AnalysisResult {
  fileName: string
  fileType: string
  detectedDocumentType?: DetectedDocumentType
  summary: string
  confidence: number
  detectedBusiness?: string
  detectedGSTIN?: string
  importData: {
    sales?: any[]
    purchases?: any[]
    expenses?: any[]
    products?: any[]
    parties?: any[]
    staff?: any[]
    bankTransactions?: any[]
  }
  warnings: string[]
  suggestions: string[]
}

const MODULE_ICONS: Record<string, React.ReactNode> = {
  sales: <ShoppingCart className="h-4 w-4 text-blue-600" />,
  purchases: <Package className="h-4 w-4 text-purple-600" />,
  expenses: <Receipt className="h-4 w-4 text-red-600" />,
  products: <Package className="h-4 w-4 text-emerald-600" />,
  parties: <Users className="h-4 w-4 text-indigo-600" />,
  staff: <Users className="h-4 w-4 text-orange-600" />,
  bankTransactions: <Banknote className="h-4 w-4 text-teal-600" />,
}

const MODULE_LABELS: Record<string, string> = {
  sales: 'Sale Invoices',
  purchases: 'Purchase Invoices',
  expenses: 'Expenses',
  products: 'Products / Inventory',
  parties: 'Parties',
  staff: 'Staff',
  bankTransactions: 'Bank Transactions',
}

/** Fetch with retry and exponential backoff */
async function fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 300000)
      const response = await fetch(url, { ...options, signal: controller.signal })
      clearTimeout(timeout)
      if (response.status >= 500 && attempt < retries) {
        await new Promise(r => setTimeout(r, [2000, 5000, 10000][attempt] || 10000))
        continue
      }
      return response
    } catch (error: any) {
      if (attempt < retries && (error.name === 'AbortError' || error.message?.includes('fetch') || error.message?.includes('network'))) {
        await new Promise(r => setTimeout(r, [2000, 5000, 10000][attempt] || 10000))
        continue
      }
      throw error
    }
  }
  throw new Error('Max retries exceeded')
}

async function safeParseJson(res: Response): Promise<any> {
  const contentType = res.headers.get('content-type') || ''
  const text = await res.text()
  if (contentType.includes('application/json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try { return JSON.parse(text) } catch { return { error: `Invalid JSON response (HTTP ${res.status})` } }
  }
  if (text.includes('<!DOCTYPE') || text.includes('<html') || contentType.includes('text/html')) {
    return { error: `Server returned an error page (HTTP ${res.status}). The AI import service may be temporarily unavailable.` }
  }
  return { error: `Unexpected response from server (HTTP ${res.status}).` }
}

type DialogStep = 'prompt' | 'analyzing' | 'results' | 'importing' | 'complete' | 'error'

interface BackupImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyName: string
}

export function BackupImportDialog({ open, companyName }: BackupImportDialogProps) {
  const { tenant, setView, setPendingImportFile } = useAppStore()
  const { toast } = useToast()

  const [step, setStep] = useState<DialogStep>('prompt')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set())
  const [errorMessage, setErrorMessage] = useState('')
  const [importResults, setImportResults] = useState<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-trigger file picker when dialog opens
  const hasAutoTriggered = useRef(false)
  const handleOpenAutoFilePicker = useCallback(() => {
    if (hasAutoTriggered.current) return
    hasAutoTriggered.current = true
    // Small delay to let dialog render
    setTimeout(() => handleSelectFile(), 300)
  }, [])

  // Reset auto-trigger flag when dialog closes
  useEffect(() => {
    if (!open) {
      hasAutoTriggered.current = false
      setStep('prompt')
      setSelectedFile(null)
      setAnalysis(null)
      setSelectedModules(new Set())
      setErrorMessage('')
      setImportResults(null)
    } else {
      // Auto-trigger file picker when dialog opens
      handleOpenAutoFilePicker()
    }
  }, [open, handleOpenAutoFilePicker])

  const resetAndClose = useCallback(() => {
    setStep('prompt')
    setSelectedFile(null)
    setAnalysis(null)
    setSelectedModules(new Set())
    setErrorMessage('')
    setImportResults(null)
    // Close the dialog by dispatching close event on the Dialog
    const event = new CustomEvent('close-backup-import')
    window.dispatchEvent(event)
  }, [])

  const handleSkip = () => {
    resetAndClose()
  }

  /** Open file picker — uses File System Access API if available, otherwise fallback to file input */
  const handleSelectFile = async () => {
    // Try the modern File System Access API first
    if ('showOpenFilePicker' in window) {
      try {
        const [fileHandle] = await (window as any).showOpenFilePicker({
          types: [{
            description: 'Excel Backup Files',
            accept: {
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
              'application/vnd.ms-excel': ['.xls'],
            },
          }],
          multiple: false,
        })
        const file = await fileHandle.getFile()
        processFile(file)
        return
      } catch (err: any) {
        // User cancelled the picker
        if (err.name === 'AbortError') return
        // Fall through to regular file input
      }
    }

    // Fallback: trigger hidden file input
    fileInputRef.current?.click()
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0])
      e.target.value = ''
    }
  }

  /** Process the selected file — start AI analysis */
  const processFile = async (file: File) => {
    if (!tenant) return

    setSelectedFile(file)
    setStep('analyzing')

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('tenantId', tenant.id)

      const res = await fetchWithRetry('/api/ai-import', { method: 'POST', body: formData })
      const data = await safeParseJson(res)

      if (res.ok && data.success) {
        const analysisResult = data.analysis as AnalysisResult
        setAnalysis(analysisResult)

        // Check if the detected business name matches the current company
        if (analysisResult.detectedBusiness && tenant.name) {
          const detectedName = analysisResult.detectedBusiness.toLowerCase().trim()
          const currentName = tenant.name.toLowerCase().trim()
          const companies = useAppStore.getState().companies

          if (detectedName !== currentName) {
            // Check if detected business matches another company
            const matchedCompany = companies.find(c =>
              c.name.toLowerCase().trim() === detectedName ||
              c.name.toLowerCase().includes(detectedName) ||
              detectedName.includes(c.name.toLowerCase().trim())
            )

            if (matchedCompany && matchedCompany.tenantId !== tenant.id) {
              // Backup belongs to a different company — switch to it
              toast({
                title: 'Different Company Detected',
                description: `This backup belongs to "${matchedCompany.name}". Switching to that company...`,
                duration: 5000,
              })
              useAppStore.getState().switchCompany(matchedCompany.tenant)
              // Re-analyze with new tenant
              resetAndClose()
              return
            } else if (!matchedCompany) {
              // Unknown company — suggest adding it
              toast({
                title: 'New Company Detected',
                description: `This backup belongs to "${analysisResult.detectedBusiness}" which is not in your account. After import, consider adding this as a new company.`,
                duration: 8000,
              })
            }
          }
        }

        // Auto-select modules based on detected type
        const modules = ['sales', 'purchases', 'expenses', 'products', 'parties', 'staff', 'bankTransactions'] as const
        const modulesWithData = new Set<string>()
        for (const mod of modules) {
          if ((analysisResult.importData[mod] as any[])?.length > 0) {
            modulesWithData.add(mod)
          }
        }

        // For backup_data or mixed_data, auto-select ALL modules with data
        if (analysisResult.detectedDocumentType === 'backup_data' || analysisResult.detectedDocumentType === 'mixed_data' || !analysisResult.detectedDocumentType || analysisResult.detectedDocumentType === 'unknown') {
          setSelectedModules(modulesWithData)
        } else {
          setSelectedModules(modulesWithData)
        }

        setStep('results')
      } else {
        setErrorMessage(data.error || 'Analysis failed. Please try again.')
        setStep('error')
      }
    } catch (error: any) {
      setErrorMessage(error.message?.includes('fetch') || error.message?.includes('retry')
        ? 'Server connection failed. Please try again later.'
        : (error.message || 'Network error'))
      setStep('error')
    }
  }

  /** Import the analyzed data into BizBook */
  const handleImport = async () => {
    if (!tenant || !analysis) return

    setStep('importing')

    try {
      const filteredData: any = {}
      selectedModules.forEach(mod => {
        if ((analysis.importData[mod as keyof typeof analysis.importData] as any[])?.length > 0) {
          filteredData[mod] = analysis.importData[mod as keyof typeof analysis.importData]
        }
      })

      const formData = new FormData()
      formData.append('action', 'apply')
      formData.append('tenantId', tenant.id)
      formData.append('importData', JSON.stringify(filteredData))

      const res = await fetchWithRetry('/api/ai-import', { method: 'POST', body: formData })
      const data = await safeParseJson(res)

      if (res.ok && data.success) {
        setImportResults(data.results)
        setStep('complete')
        toast({
          title: 'Import Complete!',
          description: data.message || 'Backup data has been imported successfully.',
        })
      } else {
        setErrorMessage(data.error || 'Some records could not be imported.')
        if (data.results) setImportResults(data.results)
        setStep('error')
      }
    } catch (error: any) {
      setErrorMessage(error.message || 'Import failed')
      setStep('error')
    }
  }

  /** Open in AI Smart Import for detailed review */
  const handleOpenInAIImport = () => {
    if (selectedFile) {
      setPendingImportFile(selectedFile)
    }
    resetAndClose()
    setView('ai-import')
  }

  const toggleModule = (mod: string) => {
    const next = new Set(selectedModules)
    if (next.has(mod)) next.delete(mod)
    else next.add(mod)
    setSelectedModules(next)
  }

  const getModuleCount = (mod: string): number => {
    if (!analysis?.importData) return 0
    const data = analysis.importData[mod as keyof typeof analysis.importData]
    return Array.isArray(data) ? data.length : 0
  }

  const totalRecords = analysis
    ? Object.keys(analysis.importData).reduce((sum, key) => sum + getModuleCount(key), 0)
    : 0
  const selectedRecords = Array.from(selectedModules).reduce((sum, mod) => sum + getModuleCount(mod), 0)

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetAndClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
            Import Backup Data
          </DialogTitle>
          <DialogDescription>
            {step === 'prompt' && `Do you have a backup Excel file to import for ${companyName}?`}
            {step === 'analyzing' && 'AI is analyzing your backup file...'}
            {step === 'results' && 'Analysis complete! Review the detected data below.'}
            {step === 'importing' && 'Importing your backup data...'}
            {step === 'complete' && 'Backup data imported successfully!'}
            {step === 'error' && 'Something went wrong'}
          </DialogDescription>
        </DialogHeader>

        {/* Step: Prompt — Ask user for file */}
        {step === 'prompt' && (
          <div className="space-y-4 py-2">
            <div className="flex flex-col items-center gap-4 p-6 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
              <div className="h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center">
                <FolderOpen className="h-8 w-8 text-emerald-600" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                  Select a backup Excel file
                </p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                  Supports .xlsx and .xls files containing business data across multiple sheets
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700"
                onClick={handleSelectFile}
              >
                <Upload className="h-4 w-4 mr-2" />
                Select Backup File
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleSkip}
              >
                Skip, Go to Dashboard
              </Button>
            </div>

            {/* Hidden file input fallback */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileInputChange}
              className="hidden"
            />
          </div>
        )}

        {/* Step: Analyzing */}
        {step === 'analyzing' && (
          <div className="space-y-4 py-6">
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <Loader2 className="h-12 w-12 animate-spin text-emerald-600" />
                <Sparkles className="h-5 w-5 text-emerald-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">Analyzing: {selectedFile?.name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  AI is reading your backup file, identifying data modules, and mapping them to BizBook Pro
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Step: Results */}
        {step === 'results' && analysis && (
          <div className="space-y-4 py-2">
            {/* File info */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
              <FileSpreadsheet className="h-8 w-8 text-emerald-600 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{selectedFile?.name}</p>
                <p className="text-xs text-muted-foreground">
                  {selectedFile ? `${(selectedFile.size / 1024).toFixed(1)} KB` : ''} • {Math.round(analysis.confidence * 100)}% confidence
                </p>
              </div>
              <Badge
                variant="outline"
                className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800"
              >
                {analysis.detectedDocumentType === 'backup_data' ? 'Backup Data' :
                 analysis.detectedDocumentType === 'mixed_data' ? 'Mixed Data' :
                 analysis.detectedDocumentType || 'Detected'}
              </Badge>
            </div>

            {/* Summary */}
            <p className="text-sm text-muted-foreground">{analysis.summary}</p>

            {/* Module selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Data Modules Detected ({totalRecords} records)</p>
                <p className="text-xs text-muted-foreground">{selectedRecords} selected</p>
              </div>

              {['sales', 'purchases', 'expenses', 'products', 'parties', 'staff', 'bankTransactions']
                .filter(mod => getModuleCount(mod) > 0)
                .map(mod => (
                  <div
                    key={mod}
                    className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors cursor-pointer ${
                      selectedModules.has(mod)
                        ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800'
                        : 'bg-muted/30 border-muted hover:bg-muted/50'
                    }`}
                    onClick={() => toggleModule(mod)}
                  >
                    <Checkbox checked={selectedModules.has(mod)} onCheckedChange={() => toggleModule(mod)} />
                    {MODULE_ICONS[mod]}
                    <span className="text-sm flex-1">{MODULE_LABELS[mod]}</span>
                    <Badge variant="outline" className="text-xs">{getModuleCount(mod)} records</Badge>
                  </div>
                ))
              }
            </div>

            {/* Warnings */}
            {analysis.warnings.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> Warnings
                </p>
                {analysis.warnings.slice(0, 3).map((w, i) => (
                  <p key={i} className="text-xs text-muted-foreground">• {w}</p>
                ))}
                {analysis.warnings.length > 3 && (
                  <p className="text-xs text-muted-foreground">...and {analysis.warnings.length - 3} more</p>
                )}
              </div>
            )}

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" size="sm" onClick={handleOpenInAIImport}>
                <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Open in AI Import (Advanced)
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={handleImport}
                disabled={selectedModules.size === 0}
              >
                Import {selectedRecords} Records
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step: Importing */}
        {step === 'importing' && (
          <div className="space-y-4 py-6">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-10 w-10 animate-spin text-emerald-600" />
              <p className="text-sm text-muted-foreground">
                Importing {selectedRecords} records into {companyName}...
              </p>
            </div>
          </div>
        )}

        {/* Step: Complete */}
        {step === 'complete' && (
          <div className="space-y-4 py-2">
            <div className="flex flex-col items-center gap-4 p-6 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="h-12 w-12 text-emerald-600" />
              <div className="text-center">
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                  Backup Imported Successfully!
                </p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                  {selectedRecords} records have been imported into {companyName}
                </p>
              </div>
            </div>

            {importResults && (
              <div className="space-y-1 text-xs text-muted-foreground">
                {Object.entries(importResults).map(([mod, res]: [string, any]) => (
                  <p key={mod}>
                    • {MODULE_LABELS[mod] || mod}: {res.created || 0} created, {res.skipped || 0} skipped
                  </p>
                ))}
              </div>
            )}

            <DialogFooter>
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={resetAndClose}>
                Go to Dashboard
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step: Error */}
        {step === 'error' && (
          <div className="space-y-4 py-2">
            <div className="flex flex-col items-center gap-4 p-6 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
              <AlertTriangle className="h-10 w-10 text-red-600" />
              <p className="text-sm text-red-700 dark:text-red-300 text-center">{errorMessage}</p>
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" size="sm" onClick={handleOpenInAIImport}>
                <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Try AI Smart Import Instead
              </Button>
              <Button size="sm" onClick={resetAndClose}>
                Close
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
