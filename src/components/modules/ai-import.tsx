'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useAppStore, canEdit } from '@/store/app-store'
import { AppHeader } from '@/components/app/header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Sparkles, Upload, Loader2, FileText, AlertTriangle, CheckCircle2,
  ShoppingCart, Package, Receipt, Users, Building2, CreditCard,
  Banknote, ChevronDown, ChevronUp, Trash2, FileUp, Brain, Zap,
  FileSpreadsheet, Image, File, RefreshCw, X, Plus, CheckCircle,
  CircleDot, FileDigit, Download
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

interface FileEntry {
  id: string
  file: File
  status: 'pending' | 'analyzing' | 'done' | 'error'
  analysis?: AnalysisResult
  error?: string
}

const FILE_TYPES_ACCEPTED = '.csv,.json,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.gif,.bmp,.webp,.txt,.tsv,.xml,.docx,.doc,.odt,.rtf'

const MAX_RETRIES = 3
const RETRY_DELAYS = [2000, 5000, 10000] // Exponential backoff: 2s, 5s, 10s

/** Fetch with retry and exponential backoff */
async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 300000) // 5 min timeout for AI analysis
      const response = await fetch(url, { ...options, signal: controller.signal })
      clearTimeout(timeout)
      if (response.status >= 500 && attempt < retries) {
        console.warn(`[AI-Import] Server error ${response.status}, retry ${attempt + 1}/${retries}...`)
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt] || 10000))
        continue
      }
      return response
    } catch (error: any) {
      if (attempt < retries && (error.name === 'AbortError' || error.message?.includes('fetch') || error.message?.includes('network') || error.message?.includes('Failed'))) {
        console.warn(`[AI-Import] Network error, retry ${attempt + 1}/${retries}...`)
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt] || 10000))
        continue
      }
      throw error
    }
  }
  throw new Error('Max retries exceeded')
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
  parties: 'Parties (Customers/Suppliers)',
  staff: 'Staff',
  bankTransactions: 'Bank Transactions',
}

const DETECTED_TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string; bgColor: string; borderColor: string; targetModules: string[] }> = {
  sale_invoice: {
    label: 'Sale Invoice',
    icon: <ShoppingCart className="h-4 w-4" />,
    color: 'text-blue-700',
    bgColor: 'bg-blue-50 dark:bg-blue-950/30',
    borderColor: 'border-blue-200 dark:border-blue-800',
    targetModules: ['sales'],
  },
  purchase_invoice: {
    label: 'Purchase Invoice',
    icon: <Package className="h-4 w-4" />,
    color: 'text-purple-700',
    bgColor: 'bg-purple-50 dark:bg-purple-950/30',
    borderColor: 'border-purple-200 dark:border-purple-800',
    targetModules: ['purchases'],
  },
  bank_statement: {
    label: 'Bank Statement',
    icon: <Banknote className="h-4 w-4" />,
    color: 'text-teal-700',
    bgColor: 'bg-teal-50 dark:bg-teal-950/30',
    borderColor: 'border-teal-200 dark:border-teal-800',
    targetModules: ['bankTransactions'],
  },
  inventory_data: {
    label: 'Inventory Data',
    icon: <Package className="h-4 w-4" />,
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/30',
    borderColor: 'border-emerald-200 dark:border-emerald-800',
    targetModules: ['products'],
  },
  expense_data: {
    label: 'Expense Records',
    icon: <Receipt className="h-4 w-4" />,
    color: 'text-red-700',
    bgColor: 'bg-red-50 dark:bg-red-950/30',
    borderColor: 'border-red-200 dark:border-red-800',
    targetModules: ['expenses'],
  },
  staff_data: {
    label: 'Staff Data',
    icon: <Users className="h-4 w-4" />,
    color: 'text-orange-700',
    bgColor: 'bg-orange-50 dark:bg-orange-950/30',
    borderColor: 'border-orange-200 dark:border-orange-800',
    targetModules: ['staff'],
  },
  party_data: {
    label: 'Party Data',
    icon: <Users className="h-4 w-4" />,
    color: 'text-indigo-700',
    bgColor: 'bg-indigo-50 dark:bg-indigo-950/30',
    borderColor: 'border-indigo-200 dark:border-indigo-800',
    targetModules: ['parties'],
  },
  backup_data: {
    label: 'Backup Data (Multi-Module)',
    icon: <FileSpreadsheet className="h-4 w-4" />,
    color: 'text-amber-700',
    bgColor: 'bg-amber-50 dark:bg-amber-950/30',
    borderColor: 'border-amber-200 dark:border-amber-800',
    targetModules: [], // all applicable modules will be auto-selected
  },
  mixed_data: {
    label: 'Mixed Business Data',
    icon: <FileText className="h-4 w-4" />,
    color: 'text-violet-700',
    bgColor: 'bg-violet-50 dark:bg-violet-950/30',
    borderColor: 'border-violet-200 dark:border-violet-800',
    targetModules: [], // all applicable modules will be auto-selected
  },
  unknown: {
    label: 'Unknown Document Type',
    icon: <File className="h-4 w-4" />,
    color: 'text-gray-700',
    bgColor: 'bg-gray-50 dark:bg-gray-950/30',
    borderColor: 'border-gray-200 dark:border-gray-800',
    targetModules: [],
  },
}

function getModuleLabel(module: string): string {
  return MODULE_LABELS[module] || module
}

function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  if (['xlsx', 'xls', 'csv', 'tsv'].includes(ext)) return <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
  if (['docx', 'doc', 'odt', 'rtf'].includes(ext)) return <FileText className="h-5 w-5 text-blue-600" />
  if (['pdf'].includes(ext)) return <FileText className="h-5 w-5 text-red-600" />
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(ext)) return <Image className="h-5 w-5 text-purple-600" />
  if (['json', 'xml'].includes(ext)) return <FileDigit className="h-5 w-5 text-amber-600" />
  return <File className="h-5 w-5 text-muted-foreground" />
}

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36) }

/** Safely parse fetch response as JSON, handling HTML error pages */
async function safeParseJson(res: Response): Promise<any> {
  const contentType = res.headers.get('content-type') || ''
  const text = await res.text()
  if (contentType.includes('application/json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try { return JSON.parse(text) } catch { return { error: `Invalid JSON response (HTTP ${res.status})` } }
  }
  if (text.includes('<!DOCTYPE') || text.includes('<html') || contentType.includes('text/html')) {
    return { error: `Server returned an error page (HTTP ${res.status}). The AI import service may be temporarily unavailable. Please try again.` }
  }
  return { error: `Unexpected response from server (HTTP ${res.status}). Please try again.` }
}

export function AIImportPage() {
  const { tenant, user, pendingImportFile, setPendingImportFile } = useAppStore()
  const { toast } = useToast()

  const [fileQueue, setFileQueue] = useState<FileEntry[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [importResults, setImportResults] = useState<any>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set())
  const [mergingFiles, setMergingFiles] = useState(false)
  const [mergedAnalysis, setMergedAnalysis] = useState<AnalysisResult | null>(null)
  const [exportingExcel, setExportingExcel] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canImport = canEdit(user?.role || 'VIEW_ONLY')

  const analyzingCount = fileQueue.filter(f => f.status === 'analyzing').length
  const doneCount = fileQueue.filter(f => f.status === 'done').length
  const errorCount = fileQueue.filter(f => f.status === 'error').length

  /** Add files to queue and start analyzing */
  const addFiles = useCallback(async (files: FileList | File[]) => {
    if (!tenant) {
      toast({ title: 'Error', description: 'Please select a company first', variant: 'destructive' })
      return
    }

    const newEntries: FileEntry[] = Array.from(files).map(file => ({
      id: uid(), file, status: 'pending' as const,
    }))

    setFileQueue(prev => [...prev, ...newEntries])
    setMergedAnalysis(null)
    setImportResults(null)

    for (const entry of newEntries) {
      setFileQueue(prev => prev.map(f => f.id === entry.id ? { ...f, status: 'analyzing' } : f))
      try {
        const formData = new FormData()
        formData.append('file', entry.file)
        formData.append('tenantId', tenant.id)
        const res = await fetchWithRetry('/api/ai-import', { method: 'POST', body: formData })
        const data = await safeParseJson(res)
        if (res.ok && data.success) {
          setFileQueue(prev => prev.map(f => f.id === entry.id ? { ...f, status: 'done', analysis: data.analysis } : f))
        } else {
          setFileQueue(prev => prev.map(f => f.id === entry.id ? { ...f, status: 'error', error: data.error || 'Analysis failed' } : f))
        }
      } catch (error: any) {
        setFileQueue(prev => prev.map(f => f.id === entry.id ? { ...f, status: 'error', error: error.message?.includes('fetch') || error.message?.includes('retry') ? 'Server connection failed after retries' : (error.message || 'Network error') } : f))
      }
    }
  }, [tenant, toast])

  // Handle pending import file from external components (e.g., BackupImportDialog)
  useEffect(() => {
    if (pendingImportFile && tenant) {
      const file = pendingImportFile
      setPendingImportFile(null) // Clear immediately to prevent re-processing
      addFiles([file])
    }
  }, [pendingImportFile, tenant, addFiles, setPendingImportFile])

  const removeFile = (id: string) => {
    setFileQueue(prev => prev.filter(f => f.id !== id))
    setMergedAnalysis(null)
  }

  const retryFile = async (entry: FileEntry) => {
    if (!tenant) return
    setFileQueue(prev => prev.map(f => f.id === entry.id ? { ...f, status: 'analyzing', error: undefined } : f))
    try {
      const formData = new FormData()
      formData.append('file', entry.file)
      formData.append('tenantId', tenant.id)
      const res = await fetchWithRetry('/api/ai-import', { method: 'POST', body: formData })
      const data = await safeParseJson(res)
      if (res.ok && data.success) {
        setFileQueue(prev => prev.map(f => f.id === entry.id ? { ...f, status: 'done', analysis: data.analysis } : f))
      } else {
        setFileQueue(prev => prev.map(f => f.id === entry.id ? { ...f, status: 'error', error: data.error || 'Analysis failed' } : f))
      }
    } catch (error: any) {
      setFileQueue(prev => prev.map(f => f.id === entry.id ? { ...f, status: 'error', error: error.message || 'Network error' } : f))
    }
  }

  /** Merge all analyzed files into a single unified dataset */
  const mergeAnalyses = useCallback(() => {
    const successful = fileQueue.filter(f => f.status === 'done' && f.analysis)
    if (successful.length === 0) return
    setMergingFiles(true)

    // Determine merged detectedDocumentType
    const singleType = successful.length === 1 ? successful[0].analysis?.detectedDocumentType : undefined
    const allTypes = successful.map(f => f.analysis?.detectedDocumentType).filter(Boolean)
    let mergedDocType: DetectedDocumentType | undefined
    if (singleType) {
      mergedDocType = singleType
    } else if (allTypes.length > 0) {
      const uniqueTypes = new Set(allTypes)
      mergedDocType = uniqueTypes.size === 1 ? allTypes[0] as DetectedDocumentType : 'mixed_data'
    }

    const merged: AnalysisResult = {
      fileName: `${successful.length} files merged`,
      fileType: 'multi-file',
      detectedDocumentType: mergedDocType,
      summary: `Combined analysis of ${successful.length} business data file(s). AI has identified data across multiple categories from your uploaded documents, spreadsheets, and images.`,
      confidence: successful.reduce((sum, f) => sum + (f.analysis?.confidence || 0), 0) / successful.length,
      detectedBusiness: successful.find(f => f.analysis?.detectedBusiness)?.analysis?.detectedBusiness,
      detectedGSTIN: successful.find(f => f.analysis?.detectedGSTIN)?.analysis?.detectedGSTIN,
      importData: { sales: [], purchases: [], expenses: [], products: [], parties: [], staff: [], bankTransactions: [] },
      warnings: [], suggestions: [],
    }

    const modules = ['sales', 'purchases', 'expenses', 'products', 'parties', 'staff', 'bankTransactions'] as const
    for (const entry of successful) {
      const a = entry.analysis!
      for (const mod of modules) {
        if (a.importData[mod]?.length) (merged.importData[mod] as any[]).push(...a.importData[mod]!)
      }
      merged.warnings.push(...a.warnings.map(w => `[${a.fileName}] ${w}`))
      merged.suggestions.push(...a.suggestions.map(s => `[${a.fileName}] ${s}`))
    }

    // Deduplicate parties by name
    if (merged.importData.parties?.length) {
      const seen = new Map<string, any>()
      for (const p of merged.importData.parties) { const key = (p.name || '').toLowerCase().trim(); if (key && !seen.has(key)) seen.set(key, p) }
      merged.importData.parties = Array.from(seen.values())
    }
    // Deduplicate products by name
    if (merged.importData.products?.length) {
      const seen = new Map<string, any>()
      for (const p of merged.importData.products) { const key = (p.name || '').toLowerCase().trim(); if (key && !seen.has(key)) seen.set(key, p) }
      merged.importData.products = Array.from(seen.values())
    }

    setMergedAnalysis(merged)
    const modulesWith = new Set<string>()
    for (const mod of modules) { if ((merged.importData[mod] as any[])?.length > 0) modulesWith.add(mod) }

    // Auto-select modules based on detected document type
    const detectedType = merged.detectedDocumentType
    const typeConfig = detectedType ? DETECTED_TYPE_CONFIG[detectedType] : undefined
    if (typeConfig && typeConfig.targetModules.length > 0) {
      // For specific types (sale_invoice, purchase_invoice, etc.), auto-select the target module(s)
      const autoModules = new Set<string>()
      for (const mod of typeConfig.targetModules) {
        if (modulesWith.has(mod)) autoModules.add(mod)
      }
      setSelectedModules(autoModules)
    } else {
      // For backup_data, mixed_data, or unknown — auto-select all modules with data
      setSelectedModules(modulesWith)
    }

    setMergingFiles(false)
    const typeLabel = typeConfig ? typeConfig.label : 'Unknown'
    toast({ title: 'Analysis Complete', description: `Detected: ${typeLabel} — Merged data from ${successful.length} file(s), found data in ${modulesWith.size} categories` })
  }, [fileQueue, toast])

  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files) }, [addFiles])
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files && e.target.files.length > 0) addFiles(e.target.files); e.target.value = '' }, [addFiles])

  const handleImport = async () => {
    if (!tenant || !mergedAnalysis) return
    setImporting(true)
    try {
      const filteredData: any = {}
      selectedModules.forEach(module => { if (mergedAnalysis.importData[module as keyof typeof mergedAnalysis.importData]) filteredData[module] = mergedAnalysis.importData[module as keyof typeof mergedAnalysis.importData] })
      const formData = new FormData()
      formData.append('action', 'apply')
      formData.append('tenantId', tenant.id)
      formData.append('importData', JSON.stringify(filteredData))
      const res = await fetchWithRetry('/api/ai-import', { method: 'POST', body: formData })
      const data = await safeParseJson(res)
      if (res.ok && data.success) {
        setImportResults(data.results)
        toast({ title: 'Import Complete', description: data.message })
      } else {
        toast({ title: 'Import Partially Failed', description: data.error || 'Some records could not be imported', variant: 'destructive' })
        if (data.results) setImportResults(data.results)
      }
      setShowConfirm(false)
    } catch (error: any) {
      toast({ title: 'Import Error', description: error.message, variant: 'destructive' })
      setShowConfirm(false)
    } finally { setImporting(false) }
  }

  /** Export merged analysis to Excel and download to physical drive */
  const handleExportExcel = async () => {
    if (!tenant || !mergedAnalysis) return
    setExportingExcel(true)
    try {
      const filteredData: any = {}
      selectedModules.forEach(module => { if (mergedAnalysis.importData[module as keyof typeof mergedAnalysis.importData]) filteredData[module] = mergedAnalysis.importData[module as keyof typeof mergedAnalysis.importData] })
      const formData = new FormData()
      formData.append('action', 'export-excel')
      formData.append('tenantId', tenant.id)
      formData.append('importData', JSON.stringify(filteredData))
      const res = await fetchWithRetry('/api/ai-import', { method: 'POST', body: formData })

      if (res.ok) {
        const blob = await res.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const contentDisposition = res.headers.get('Content-Disposition')
        const fileName = contentDisposition?.match(/filename="?([^"]+)"?/)?.[1] || `${tenant.name || 'BizBook'}_AI_Import.xlsx`
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        window.URL.revokeObjectURL(url)
        toast({ title: 'Excel Downloaded', description: `${fileName} saved to your downloads folder` })
      } else {
        const data = await safeParseJson(res)
        toast({ title: 'Export Failed', description: data.error || 'Could not generate Excel', variant: 'destructive' })
      }
    } catch (error: any) {
      toast({ title: 'Export Error', description: error.message, variant: 'destructive' })
    } finally { setExportingExcel(false) }
  }

  const toggleModule = (module: string) => { const next = new Set(selectedModules); if (next.has(module)) next.delete(module); else next.add(module); setSelectedModules(next) }
  const toggleExpand = (module: string) => { const next = new Set(expandedModules); if (next.has(module)) next.delete(module); else next.add(module); setExpandedModules(next) }

  const getModuleCount = (module: string): number => {
    if (!mergedAnalysis?.importData) return 0
    const data = mergedAnalysis.importData[module as keyof typeof mergedAnalysis.importData]
    return Array.isArray(data) ? data.length : 0
  }

  const totalRecords = mergedAnalysis ? Object.keys(mergedAnalysis.importData).reduce((sum, key) => sum + getModuleCount(key), 0) : 0
  const selectedRecords = Array.from(selectedModules).reduce((sum, mod) => sum + getModuleCount(mod), 0)

  const confidenceColor = mergedAnalysis ? mergedAnalysis.confidence >= 0.8 ? 'text-emerald-600' : mergedAnalysis.confidence >= 0.5 ? 'text-amber-600' : 'text-red-600' : ''

  const formatItemPreview = (item: any, module: string): string => {
    switch (module) {
      case 'sales': case 'purchases': return `${item.invoiceNumber || 'No#'} | ${item.partyName || 'N/A'} | ₹${item.grandTotal || 0}`
      case 'expenses': return `${item.description || 'N/A'} | ${item.category || 'N/A'} | ₹${item.amount || 0}`
      case 'products': return `${item.name || 'N/A'} | ${item.category || 'N/A'} | ₹${item.saleRate || 0} | Stock: ${item.stock || 0}`
      case 'parties': return `${item.name || 'N/A'} | ${item.type || 'N/A'} | ${item.gstin || 'No GSTIN'}`
      case 'staff': return `${item.name || 'N/A'} | ${item.role || 'N/A'} | ₹${item.salary || 0}`
      case 'bankTransactions': return `${item.description || 'N/A'} | ${item.type || 'N/A'} | ₹${item.amount || 0}`
      default: return JSON.stringify(item).slice(0, 80)
    }
  }

  const resetAll = () => { setFileQueue([]); setMergedAnalysis(null); setImportResults(null); setSelectedModules(new Set()); setExpandedModules(new Set()) }

  return (
    <div>
      <AppHeader title="AI Smart Import" />
      <div className="p-4 sm:p-6 pb-8 space-y-4">

        {/* Header Card */}
        <Card className="border-0 shadow-sm bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-950/30 dark:to-purple-950/30">
          <CardContent className="p-5">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-lg">
                <Brain className="h-7 w-7" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-violet-900 dark:text-violet-100">
                  AI-Powered Multi-File Smart Import
                </h2>
                <p className="text-sm text-violet-700 dark:text-violet-300 mt-1">
                  Upload multiple business data files — expenses in Word, purchases in Excel, inventory in another file, invoices as PDF/images,
                  party lists in CSV, and more. Our AI will deeply analyze each file, intelligently merge the data, and help you import
                  everything into BizBook Pro as one unified dataset. You can also export everything to a single Excel file.
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {['CSV', 'Excel', 'Word', 'JSON', 'PDF', 'Images', 'Tally XML', 'Text', 'RTF'].map(type => (
                    <Badge key={type} variant="outline" className="text-xs bg-white/50 dark:bg-white/10">{type}</Badge>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Upload Area */}
        {!mergedAnalysis && !importResults && (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div
                className={`relative border-2 border-dashed rounded-xl p-6 sm:p-10 text-center transition-all duration-200 ${
                  dragOver ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30'
                    : 'border-muted-foreground/25 hover:border-violet-400 hover:bg-violet-50/50 dark:hover:bg-violet-950/20'
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                {analyzingCount > 0 ? (
                  <div className="space-y-4">
                    <div className="relative mx-auto w-16 h-16">
                      <Loader2 className="h-16 w-16 animate-spin text-violet-600" />
                      <Sparkles className="h-6 w-6 text-violet-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse" />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-violet-700 dark:text-violet-300">AI is analyzing your files...</p>
                      <p className="text-sm text-muted-foreground mt-1">Deep-reading data, identifying patterns, and mapping to BizBook Pro modules</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="mx-auto w-16 h-16 rounded-full bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center">
                      <FileUp className="h-8 w-8 text-violet-600" />
                    </div>
                    <div>
                      <p className="text-base font-semibold">Drag & drop your business files here</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Upload multiple files at once — expenses in Word, purchases in Excel, inventory in another file, images of bills, and more
                      </p>
                    </div>
                    <Button className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700" onClick={() => fileInputRef.current?.click()}>
                      <Plus className="h-4 w-4 mr-2" /> Add Files
                    </Button>
                    <input ref={fileInputRef} type="file" accept={FILE_TYPES_ACCEPTED} onChange={handleFileSelect} className="hidden" multiple />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* File Queue */}
        {fileQueue.length > 0 && !mergedAnalysis && !importResults && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileUp className="h-4 w-4 text-violet-600" />
                  Uploaded Files ({fileQueue.length})
                  {doneCount > 0 && <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300">{doneCount} analyzed</Badge>}
                  {errorCount > 0 && <Badge variant="outline" className="text-xs text-red-600 border-red-300">{errorCount} failed</Badge>}
                  {analyzingCount > 0 && <Badge variant="outline" className="text-xs text-violet-600 border-violet-300">{analyzingCount} analyzing</Badge>}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => fileInputRef.current?.click()}>
                    <Plus className="h-3 w-3 mr-1" /> Add More
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-red-600" onClick={resetAll}>
                    <Trash2 className="h-3 w-3 mr-1" /> Clear All
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {fileQueue.map(entry => (
                  <div key={entry.id} className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                    entry.status === 'done' ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800' :
                    entry.status === 'error' ? 'bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-800' :
                    entry.status === 'analyzing' ? 'bg-violet-50/50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-800' :
                    'bg-muted/30 border-muted'
                  }`}>
                    {getFileIcon(entry.file.name)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{entry.file.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{(entry.file.size / 1024).toFixed(1)} KB</span>
                        {entry.status === 'done' && entry.analysis && (
                          <>
                            <span>•</span>
                            <span className="text-emerald-600">{Math.round(entry.analysis.confidence * 100)}% confidence</span>
                            {entry.analysis.detectedDocumentType && entry.analysis.detectedDocumentType !== 'unknown' && (
                              <>
                                <span>•</span>
                                <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${DETECTED_TYPE_CONFIG[entry.analysis.detectedDocumentType]?.color || ''} ${DETECTED_TYPE_CONFIG[entry.analysis.detectedDocumentType]?.borderColor || ''}`}>
                                  {DETECTED_TYPE_CONFIG[entry.analysis.detectedDocumentType]?.label || entry.analysis.detectedDocumentType}
                                </Badge>
                              </>
                            )}
                            <span>•</span>
                            <span>{Object.keys(entry.analysis.importData).filter(k => (entry.analysis!.importData[k as keyof typeof entry.analysis.importData] as any[])?.length > 0).length} categories</span>
                            <span>•</span>
                            <span className="truncate max-w-[200px]">{entry.analysis.summary}</span>
                          </>
                        )}
                        {entry.status === 'analyzing' && (
                          <><span>•</span><span className="text-violet-600 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Deep analyzing...</span></>
                        )}
                        {entry.status === 'error' && (
                          <><span>•</span><span className="text-red-600">{entry.error}</span></>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {entry.status === 'error' && (
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => retryFile(entry)}>
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600" onClick={() => removeFile(entry.id)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {fileQueue.length > 0 && (
                <div className="pt-4 flex justify-end">
                  <Button className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 px-8" onClick={mergeAnalyses} disabled={analyzingCount > 0 || doneCount === 0 || mergingFiles}>
                    {mergingFiles ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                    {mergingFiles ? 'Merging...' : analyzingCount > 0 ? `Wait for ${analyzingCount} file(s)...` : `Merge & Analyze ${doneCount} File(s)`}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Merged Analysis Results */}
        {mergedAnalysis && !importResults && (
          <>
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-violet-600" />
                    AI Analysis Results — Merged from {fileQueue.filter(f => f.status === 'done').length} file(s)
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={resetAll}><RefreshCw className="h-3 w-3 mr-1" /> Start Over</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Files Analyzed</p>
                    <p className="text-lg font-bold">{fileQueue.filter(f => f.status === 'done').length}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Confidence</p>
                    <p className={`text-lg font-bold ${confidenceColor}`}>{Math.round(mergedAnalysis.confidence * 100)}%</p>
                    <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                      <div className={`h-1.5 rounded-full ${mergedAnalysis.confidence >= 0.8 ? 'bg-emerald-500' : mergedAnalysis.confidence >= 0.5 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${mergedAnalysis.confidence * 100}%` }} />
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Total Records</p>
                    <p className="text-lg font-bold">{totalRecords}</p>
                    <p className="text-xs text-muted-foreground">{selectedRecords} selected for import</p>
                  </div>
                </div>

                {/* Detected Document Type Banner */}
                {mergedAnalysis.detectedDocumentType && mergedAnalysis.detectedDocumentType !== 'unknown' && (() => {
                  const dt = mergedAnalysis.detectedDocumentType
                  const config = DETECTED_TYPE_CONFIG[dt]
                  if (!config) return null
                  const targetLabels = config.targetModules.length > 0
                    ? config.targetModules.map(m => getModuleLabel(m)).join(', ')
                    : 'All applicable modules'
                  return (
                    <div className={`p-4 rounded-lg border ${config.bgColor} ${config.borderColor}`}>
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${config.bgColor} ${config.color}`}>
                          {config.icon}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge className={`${config.bgColor} ${config.color} ${config.borderColor} border text-xs font-semibold`}>
                              Detected: {config.label}
                            </Badge>
                            <span className="text-sm text-muted-foreground">→</span>
                            <span className="text-sm font-medium">Will import to <strong>{targetLabels}</strong></span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            AI auto-detected this document type. You can change the target module below by toggling the checkboxes.
                          </p>
                        </div>
                        <div className="flex-shrink-0">
                          <CircleDot className={`h-5 w-5 ${config.color}`} />
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {/* v4.9: Spec Section "AI Smart Import Engine (Dynamic Classification & User-Driven Module Routing)" —
                    User-Override Option (Crucial Requirement):
                    "Even if the AI scores the document as a Purchase Invoice with high confidence,
                     do not automatically force a Purchase entry. The UI must prompt the user with
                     targeted action triggers." */}
                {mergedAnalysis?.detectedDocumentType &&
                 ['purchase_invoice', 'sale_invoice'].includes(mergedAnalysis.detectedDocumentType) && (
                  <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles className="h-4 w-4 text-violet-600" />
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        Document Identified: {DETECTED_TYPE_CONFIG[mergedAnalysis.detectedDocumentType]?.label || 'Invoice'} — What action would you like to perform with this data?
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          setSelectedModules(new Set(['purchases']))
                          toast({ title: 'Routed to Purchase Entry', description: 'Increases Accounts Payable / Creditors & logs stock input' })
                        }}
                        className={`flex items-start gap-2 p-3 rounded-lg border text-left transition-all ${
                          selectedModules.has('purchases')
                            ? 'border-violet-400 bg-violet-50 dark:bg-violet-950/30'
                            : 'border-slate-200 hover:border-violet-300 bg-white dark:bg-slate-900'
                        }`}
                      >
                        <Package className="h-4 w-4 text-purple-600 mt-0.5" />
                        <div>
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-200">Record as Purchase Entry</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">Increases Accounts Payable / Creditors & logs stock input</div>
                        </div>
                      </button>

                      <button
                        onClick={() => {
                          setSelectedModules(new Set(['sales']))
                          toast({ title: 'Convert to Sales Invoice', description: 'Pulls all extracted products into a clean Sales Screen' })
                        }}
                        className={`flex items-start gap-2 p-3 rounded-lg border text-left transition-all ${
                          selectedModules.has('sales')
                            ? 'border-violet-400 bg-violet-50 dark:bg-violet-950/30'
                            : 'border-slate-200 hover:border-violet-300 bg-white dark:bg-slate-900'
                        }`}
                      >
                        <ShoppingCart className="h-4 w-4 text-blue-600 mt-0.5" />
                        <div>
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-200">Convert to Sales Invoice</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">Pulls all extracted products into a clean Sales Screen to bill a customer</div>
                        </div>
                      </button>

                      <button
                        onClick={() => {
                          setSelectedModules(new Set(['sales']))
                          toast({ title: 'Load into Quotation / Proforma', description: 'Saves items as an active sales offer' })
                        }}
                        className={`flex items-start gap-2 p-3 rounded-lg border text-left transition-all ${
                          selectedModules.has('sales')
                            ? 'border-violet-400 bg-violet-50 dark:bg-violet-950/30'
                            : 'border-slate-200 hover:border-violet-300 bg-white dark:bg-slate-900'
                        }`}
                      >
                        <FileText className="h-4 w-4 text-amber-600 mt-0.5" />
                        <div>
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-200">Load into Quotation / Proforma</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">Saves items as an active sales offer</div>
                        </div>
                      </button>

                      <button
                        onClick={() => {
                          setSelectedModules(new Set(['products']))
                          toast({ title: 'Bulk Ingest into Stock In', description: 'Updates pure physical inventory counts without financial ledger mutation' })
                        }}
                        className={`flex items-start gap-2 p-3 rounded-lg border text-left transition-all ${
                          selectedModules.has('products')
                            ? 'border-violet-400 bg-violet-50 dark:bg-violet-950/30'
                            : 'border-slate-200 hover:border-violet-300 bg-white dark:bg-slate-900'
                        }`}
                      >
                        <Package className="h-4 w-4 text-emerald-600 mt-0.5" />
                        <div>
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-200">Bulk Ingest into Stock In</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">Updates pure physical inventory counts without financial ledger mutation</div>
                        </div>
                      </button>
                    </div>
                  </div>
                )}

                {mergedAnalysis.detectedDocumentType === 'unknown' && (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <p className="text-xs text-amber-700">
                        Could not auto-detect document type. Please manually select the modules to import below.
                      </p>
                    </div>
                  </div>
                )}

                {mergedAnalysis.detectedBusiness && (
                  <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                    <p className="text-xs text-blue-600">Detected Business: <span className="font-semibold">{mergedAnalysis.detectedBusiness}</span></p>
                    {mergedAnalysis.detectedGSTIN && <p className="text-xs text-blue-600">GSTIN: <span className="font-semibold">{mergedAnalysis.detectedGSTIN}</span></p>}
                  </div>
                )}

                {mergedAnalysis.warnings.length > 0 && (
                  <div className="space-y-1">
                    {mergedAnalysis.warnings.slice(0, 5).map((w, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-amber-600">
                        <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Module selection */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">
                      {mergedAnalysis.detectedDocumentType && mergedAnalysis.detectedDocumentType !== 'unknown' && DETECTED_TYPE_CONFIG[mergedAnalysis.detectedDocumentType]?.targetModules?.length
                        ? 'Confirm or change import destination:'
                        : 'Select modules to import:'}
                    </p>
                    {mergedAnalysis.detectedDocumentType && mergedAnalysis.detectedDocumentType !== 'unknown' && DETECTED_TYPE_CONFIG[mergedAnalysis.detectedDocumentType]?.targetModules?.length && (
                      <p className="text-xs text-muted-foreground">AI-recommended module is pre-selected</p>
                    )}
                  </div>
                  {['sales', 'purchases', 'expenses', 'products', 'parties', 'staff', 'bankTransactions'].map(module => {
                    const count = getModuleCount(module)
                    if (count === 0) return null
                    const isExpanded = expandedModules.has(module)
                    const isDetectedTarget = mergedAnalysis.detectedDocumentType
                      ? (DETECTED_TYPE_CONFIG[mergedAnalysis.detectedDocumentType]?.targetModules || []).includes(module)
                      : false
                    return (
                      <div key={module} className={`border rounded-lg p-3 transition-colors ${isDetectedTarget ? 'border-violet-300 bg-violet-50/30 dark:border-violet-700 dark:bg-violet-950/20' : ''}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Checkbox checked={selectedModules.has(module)} onCheckedChange={() => toggleModule(module)} />
                            {MODULE_ICONS[module]}
                            <span className="text-sm font-medium">{MODULE_LABELS[module]}</span>
                            <Badge variant="outline" className="text-xs">{count} records</Badge>
                            {isDetectedTarget && (
                              <Badge className="text-[10px] h-4 px-1.5 bg-violet-100 text-violet-700 border-violet-300 dark:bg-violet-900 dark:text-violet-300">
                                <Sparkles className="h-2.5 w-2.5 mr-0.5" /> AI Recommended
                              </Badge>
                            )}
                          </div>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => toggleExpand(module)}>
                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </Button>
                        </div>
                        {isExpanded && (
                          <div className="mt-2 max-h-48 overflow-y-auto">
                            <Table>
                              <TableHeader><TableRow><TableHead className="text-xs h-8">#</TableHead><TableHead className="text-xs h-8">Preview</TableHead></TableRow></TableHeader>
                              <TableBody>
                                {(mergedAnalysis.importData[module as keyof typeof mergedAnalysis.importData] as any[])?.slice(0, 20).map((item, i) => (
                                  <TableRow key={i}><TableCell className="text-xs py-1">{i + 1}</TableCell><TableCell className="text-xs py-1">{formatItemPreview(item, module)}</TableCell></TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Action buttons */}
                <div className="flex flex-col sm:flex-row gap-2 pt-2">
                  <Button className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 px-8" disabled={selectedRecords === 0 || importing} onClick={() => setShowConfirm(true)}>
                    <Zap className="h-4 w-4 mr-2" />
                    Import {selectedRecords} Records to BizBook Pro
                  </Button>
                  <Button variant="outline" className="px-6" disabled={selectedRecords === 0 || exportingExcel} onClick={handleExportExcel}>
                    {exportingExcel ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                    Export {selectedRecords} Records to Excel
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* Import Results */}
        {importResults && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                Import Complete
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {importResults.parties > 0 && <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30"><p className="text-xs text-muted-foreground">Parties</p><p className="text-lg font-bold text-emerald-600">{importResults.parties}</p></div>}
                {importResults.products > 0 && <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30"><p className="text-xs text-muted-foreground">Products</p><p className="text-lg font-bold text-emerald-600">{importResults.products}</p></div>}
                {importResults.sales > 0 && <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30"><p className="text-xs text-muted-foreground">Sales</p><p className="text-lg font-bold text-emerald-600">{importResults.sales}</p></div>}
                {importResults.purchases > 0 && <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30"><p className="text-xs text-muted-foreground">Purchases</p><p className="text-lg font-bold text-emerald-600">{importResults.purchases}</p></div>}
                {importResults.expenses > 0 && <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30"><p className="text-xs text-muted-foreground">Expenses</p><p className="text-lg font-bold text-emerald-600">{importResults.expenses}</p></div>}
                {importResults.staff > 0 && <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30"><p className="text-xs text-muted-foreground">Staff</p><p className="text-lg font-bold text-emerald-600">{importResults.staff}</p></div>}
                {importResults.bankTransactions > 0 && <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30"><p className="text-xs text-muted-foreground">Bank Txns</p><p className="text-lg font-bold text-emerald-600">{importResults.bankTransactions}</p></div>}
              </div>
              {importResults.errors?.length > 0 && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200">
                  <p className="text-xs font-medium text-red-600 mb-1">Errors ({importResults.errors.length}):</p>
                  {importResults.errors.slice(0, 10).map((err: string, i: number) => (
                    <p key={i} className="text-xs text-red-500">{err}</p>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={resetAll}><Plus className="h-4 w-4 mr-2" /> Import More Files</Button>
                <Button variant="outline" onClick={handleExportExcel} disabled={exportingExcel}>
                  {exportingExcel ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                  Export to Excel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Confirm Import Dialog */}
        <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Import</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              You are about to import <strong>{selectedRecords}</strong> records from <strong>{fileQueue.filter(f => f.status === 'done').length}</strong> file(s) into BizBook Pro.
              {importResults?.errors?.length > 0 && ' Some records may be skipped if they already exist.'}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowConfirm(false)}>Cancel</Button>
              <Button className="bg-gradient-to-r from-violet-600 to-purple-600" onClick={handleImport} disabled={importing}>
                {importing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
                Confirm Import
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
