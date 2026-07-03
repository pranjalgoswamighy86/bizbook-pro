'use client'

/**
 * AI Smart Search Dropdown
 *
 * Replaces the plain text-search input in the header with an AI-powered
 * natural-language search. User can ask things like:
 *   - "show me last month's sales"
 *   - "who owes me money?"
 *   - "find invoice INV-001"
 *   - "low stock items"
 *
 * The AI interprets the query, searches across modules, and shows ranked
 * results in a dropdown. Clicking a result navigates to the relevant
 * module and records the click for self-improvement.
 *
 * Self-improvement: every search + click is logged server-side. Over time,
 * the most-clicked result types for similar queries will rank higher
 * (planned future enhancement — current implementation just logs the data).
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAppStore, type ViewType } from '@/store/app-store'
import { Input } from '@/components/ui/input'
import { Sparkles, Search, Loader2, TrendingUp, Package, ShoppingCart, Receipt, Users, Building2, CreditCard, Banknote, UserCheck, UserX, FileText, X, Brain } from 'lucide-react'
import { cn } from '@/lib/utils'
import { authFetch } from '@/lib/auth-fetch'
import { useToast } from '@/hooks/use-toast'

interface SearchResult {
  type: string
  id: string
  title: string
  subtitle: string
  amount?: number
  date?: string
  module: string
  relevance: number
}

interface SmartSearchResponse {
  query: string
  interpreted: {
    intent: string
    modules: string[]
    dateRange?: { from?: string; to?: string }
    filters?: Record<string, unknown>
  }
  results: SearchResult[]
  suggestions: string[]
  totalFound: number
  searchId: string
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  sale: <ShoppingCart className="h-4 w-4 text-emerald-600" />,
  purchase: <Package className="h-4 w-4 text-blue-600" />,
  expense: <Receipt className="h-4 w-4 text-red-600" />,
  product: <Package className="h-4 w-4 text-purple-600" />,
  inventory: <Package className="h-4 w-4 text-amber-600" />,
  party: <Users className="h-4 w-4 text-cyan-600" />,
  staff: <Users className="h-4 w-4 text-indigo-600" />,
  bank: <Building2 className="h-4 w-4 text-sky-600" />,
  payment: <CreditCard className="h-4 w-4 text-orange-600" />,
  receipt: <Banknote className="h-4 w-4 text-green-600" />,
  debtor: <UserCheck className="h-4 w-4 text-rose-600" />,
  creditor: <UserX className="h-4 w-4 text-fuchsia-600" />,
  journal: <FileText className="h-4 w-4 text-slate-600" />,
}

// Maps the result.module string to the ViewType used by the store
const MODULE_TO_VIEW: Record<string, ViewType> = {
  sales: 'sales',
  purchases: 'purchases',
  expenses: 'expenses',
  inventory: 'inventory',
  parties: 'sales',  // parties are managed inside sales/purchases
  staff: 'staff',
  bank: 'bank',
  payments: 'payments',
  receipts: 'receipts',
  debtors: 'debtors',
  creditors: 'creditors',
}

interface SmartSearchProps {
  /** Compact mode for small screens (icon only when collapsed) */
  compact?: boolean
}

export function SmartSearch({ compact = false }: SmartSearchProps) {
  const { tenant, setView, setSearchQuery } = useAppStore()
  const { toast } = useToast()

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState<SmartSearchResponse | null>(null)
  const [error, setError] = useState('')

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const abortRef = useRef<AbortController | null>(null)

  // === Close on outside click ===
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // === Debounced search ===
  const runSearch = useCallback(async (q: string) => {
    if (!q || q.trim().length < 2) {
      setResponse(null)
      setError('')
      setLoading(false)
      return
    }

    if (!tenant?.id) {
      setError('Please select a company first.')
      setLoading(false)
      return
    }

    // Abort previous request
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError('')

    try {
      const res = await authFetch('/api/ai-smart-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant.id, query: q }),
        signal: abortRef.current.signal,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Search failed')
        setResponse(null)
        return
      }

      const data: SmartSearchResponse = await res.json()
      setResponse(data)
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError('Network error. Please try again.')
      setResponse(null)
    } finally {
      setLoading(false)
    }
  }, [tenant?.id])

  // === Debounce input changes ===
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    setOpen(true)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      runSearch(val)
    }, 400)
  }

  // === Handle result click ===
  const handleResultClick = async (result: SearchResult) => {
    // Record click for self-improvement
    if (response?.searchId) {
      try {
        await authFetch('/api/ai-smart-search', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId: tenant?.id,
            searchId: response.searchId,
            clickedResultType: result.type,
          }),
        })
      } catch {}
    }

    // Navigate to the relevant module
    const view = MODULE_TO_VIEW[result.module] || 'dashboard'
    setView(view)

    // Pre-fill the module's search box with the result title so the user
    // can immediately see what they were looking for in context.
    setSearchQuery(result.title.split('—')[0].trim())

    // Close dropdown
    setOpen(false)
    setQuery('')

    toast({
      title: 'Navigated',
      description: `Opened ${view} module — showing "${result.title}"`,
      duration: 2500,
    })
  }

  // === Keyboard shortcut: Ctrl/Cmd+K focuses the search ===
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
      if (e.key === 'Escape') {
        setOpen(false)
        inputRef.current?.blur()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  return (
    <div ref={containerRef} className={cn('relative', compact && 'w-full')}>
      {/* Search input */}
      <div className="relative">
        {loading ? (
          <Loader2 className="absolute left-2.5 top-2.5 h-4 w-4 text-emerald-600 animate-spin" />
        ) : (
          <Sparkles className="absolute left-2.5 top-2.5 h-4 w-4 text-emerald-600" />
        )}
        <Input
          ref={inputRef}
          placeholder="Ask AI: 'last month sales', 'who owes me?'…"
          value={query}
          onChange={handleInputChange}
          onFocus={() => setOpen(true)}
          className={cn(
            'pl-8 h-9 bg-emerald-50/50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800',
            compact ? 'w-full text-sm' : 'w-64 lg:w-80 text-sm'
          )}
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(''); setResponse(null); setError(''); inputRef.current?.focus() }}
            className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Dropdown results */}
      {open && (query.length >= 2 || error) && (
        <div className="absolute right-0 top-full mt-1 w-[min(28rem,90vw)] bg-card border rounded-lg shadow-xl z-50 max-h-[70vh] overflow-hidden flex flex-col">
          {/* AI interpretation banner */}
          {response && (
            <div className="px-3 py-2 bg-emerald-50 dark:bg-emerald-950/50 border-b border-emerald-100 dark:border-emerald-900">
              <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                <Brain className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="font-medium">AI interpretation:</span>
                <span className="text-emerald-600 dark:text-emerald-400 truncate">{response.interpreted.intent}</span>
              </div>
              {response.interpreted.modules.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {response.interpreted.modules.map(m => (
                    <span key={m} className="text-[10px] px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 rounded">
                      {m}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Loading */}
          {loading && !error && (
            <div className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              AI is searching your business data…
            </div>
          )}

          {/* Results */}
          {!loading && !error && response && (
            <>
              {response.results.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <Search className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  No results found for "{response.query}"
                  <div className="mt-3 text-xs">
                    Try one of these:
                    <div className="mt-2 flex flex-col gap-1">
                      {response.suggestions.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => { setQuery(s); runSearch(s) }}
                          className="text-emerald-600 hover:text-emerald-700 hover:underline"
                        >
                          "{s}"
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="px-3 py-1.5 text-xs text-muted-foreground border-b bg-muted/30">
                    {response.totalFound} result{response.totalFound !== 1 ? 's' : ''} • Top {response.results.length} shown
                  </div>
                  <div className="overflow-y-auto flex-1">
                    {response.results.map((r, idx) => (
                      <button
                        key={`${r.type}-${r.id}-${idx}`}
                        onClick={() => handleResultClick(r)}
                        className="w-full px-3 py-2 hover:bg-accent flex items-start gap-2 text-left border-b last:border-b-0"
                      >
                        <div className="mt-0.5 flex-shrink-0">
                          {TYPE_ICON[r.type] || <FileText className="h-4 w-4 text-muted-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{r.title}</div>
                          <div className="text-xs text-muted-foreground truncate">{r.subtitle}</div>
                        </div>
                        {r.amount !== undefined && (
                          <div className="text-xs font-semibold text-emerald-600 flex-shrink-0">
                            ₹{r.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Suggestions */}
              {response.suggestions.length > 0 && response.results.length > 0 && (
                <div className="px-3 py-2 border-t bg-muted/30">
                  <div className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" /> You can also ask:
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {response.suggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => { setQuery(s); runSearch(s) }}
                        className="text-[11px] px-2 py-0.5 bg-background border rounded hover:bg-accent text-emerald-700 dark:text-emerald-400"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Empty query hint */}
          {!response && !loading && !error && query.length >= 2 && (
            <div className="p-4 text-xs text-muted-foreground">
              Type at least 2 characters to search…
            </div>
          )}

          {/* Footer hint */}
          <div className="px-3 py-1.5 bg-muted/50 border-t text-[10px] text-muted-foreground flex items-center justify-between">
            <span>Press <kbd className="px-1 py-0.5 bg-background border rounded text-[9px]">Ctrl+K</kbd> to focus • <kbd className="px-1 py-0.5 bg-background border rounded text-[9px]">Esc</kbd> to close</span>
            <span className="text-emerald-600">AI Smart Search • Learns from your clicks</span>
          </div>
        </div>
      )}
    </div>
  )
}
