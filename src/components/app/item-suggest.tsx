'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authFetch } from '@/lib/auth-fetch'

interface ItemSuggestion {
  id: string
  name: string
  sku: string | null
  hsnCode: string | null
  unit: string | null
  category: string | null
  salePrice: number | null
  purchasePrice: number | null
  mrp: number | null
  gstRate: number | null
  currentStock: number | null
  itemType: string | null
  barcode: string | null
}

interface ItemSuggestProps {
  tenantId: string | undefined
  value: string
  onChange: (value: string) => void
  onItemSelect: (item: ItemSuggestion) => void
  label?: string
  placeholder?: string
  required?: boolean
  /** 'sale' shows salePrice, 'purchase' shows purchasePrice */
  priceMode?: 'sale' | 'purchase'
  className?: string
}

export function ItemSuggest({
  tenantId,
  value,
  onChange,
  onItemSelect,
  label = 'Item Name',
  placeholder = 'Type item name or scan barcode...',
  required = false,
  priceMode = 'sale',
  className = '',
}: ItemSuggestProps) {
  const [suggestions, setSuggestions] = useState<ItemSuggestion[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  // Barcode scanner detection: USB scanners send rapid keystrokes
  const keystrokeTimesRef = useRef<number[]>([])
  const barcodeBufferRef = useRef<string>('')
  const isBarcodeScanRef = useRef(false)

  const searchItems = useCallback(async (query: string) => {
    if (!tenantId || query.length < 1) {
      setSuggestions([])
      setShowDropdown(false)
      return
    }
    try {
      const res = await authFetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', tenantId, search: query }),
      })
      const data = await res.json()
      const items = (data.items || []).slice(0, 15) // Limit to 15 suggestions
      setSuggestions(items)
      setShowDropdown(items.length > 0)
      setHighlightedIndex(-1)
    } catch {
      setSuggestions([])
    }
  }, [tenantId])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    onChange(val)

    // Detect barcode scanner input: rapid keystrokes (< 50ms between chars)
    const now = Date.now()
    keystrokeTimesRef.current.push(now)
    // Keep only last 10 keystroke times
    if (keystrokeTimesRef.current.length > 10) {
      keystrokeTimesRef.current = keystrokeTimesRef.current.slice(-10)
    }

    // Check if this looks like a barcode scan (rapid input)
    const times = keystrokeTimesRef.current
    if (times.length >= 4) {
      const avgInterval = (times[times.length - 1] - times[0]) / (times.length - 1)
      if (avgInterval < 50) {
        // This is likely a barcode scanner input
        isBarcodeScanRef.current = true
        barcodeBufferRef.current = val
      } else {
        isBarcodeScanRef.current = false
        barcodeBufferRef.current = ''
      }
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      // If it was a barcode scan, search by barcode first
      if (isBarcodeScanRef.current && barcodeBufferRef.current) {
        searchItems(barcodeBufferRef.current)
        isBarcodeScanRef.current = false
        barcodeBufferRef.current = ''
      } else {
        searchItems(val)
      }
    }, isBarcodeScanRef.current ? 50 : 150)
  }

  const handleSelect = (item: ItemSuggestion) => {
    onChange(item.name)
    onItemSelect(item)
    setShowDropdown(false)
    setSuggestions([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || suggestions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(prev => Math.min(prev + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault()
      handleSelect(suggestions[highlightedIndex])
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
    } else if (e.key === 'Tab' && highlightedIndex >= 0) {
      handleSelect(suggestions[highlightedIndex])
    }
  }

  const handleFocus = () => {
    if (value.length >= 1 && suggestions.length > 0) {
      setShowDropdown(true)
    } else if (value.length >= 1) {
      searchItems(value)
    }
  }

  const formatPrice = (item: ItemSuggestion) => {
    const price = priceMode === 'sale' ? item.salePrice : item.purchasePrice
    return price ? `₹${price.toLocaleString('en-IN')}` : ''
  }

  return (
    <div className={`relative ${className}`}>
      {label && <Label className="text-xs text-muted-foreground">{label}{required && ' *'}</Label>}
      <Input
        ref={inputRef}
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
      />
      {showDropdown && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 w-full min-w-[320px] bg-popover border border-border rounded-md shadow-lg max-h-56 overflow-y-auto"
        >
          {suggestions.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors border-b border-border/50 last:border-0 ${
                idx === highlightedIndex ? 'bg-accent' : ''
              }`}
              onMouseDown={(e) => {
                e.preventDefault()
                handleSelect(item)
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <span className="font-medium truncate block">{item.name}</span>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                    {item.category && <span>{item.category}</span>}
                    {item.hsnCode && <span>HSN: {item.hsnCode}</span>}
                    {item.sku && <span>SKU: {item.sku}</span>}
                  </div>
                </div>
                <div className="text-right ml-3 flex-shrink-0">
                  <span className="font-semibold text-emerald-700">{formatPrice(item)}</span>
                  {item.currentStock !== null && (
                    <div className={`text-xs ${item.currentStock <= 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                      Stock: {item.currentStock} {item.unit || ''}
                    </div>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
