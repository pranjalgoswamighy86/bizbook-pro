'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authFetch } from '@/lib/auth-fetch'

interface ItemSuggestion {
  id: string
  name: string
  category: string | null
  hsnCode: string | null
  unit: string
  salePrice: number
  purchasePrice: number
  gstRate: number
  mrp: number | null
  itemType: string
  currentStock: number
  barcode: string | null
}

interface ItemSuggestProps {
  tenantId: string | undefined
  value: string
  onChange: (value: string) => void
  onItemSelect: (item: ItemSuggestion) => void
  label?: string
  placeholder?: string
  className?: string
  priceType?: 'salePrice' | 'purchasePrice'
}

export function ItemSuggest({
  tenantId,
  value,
  onChange,
  onItemSelect,
  label = 'Item Name',
  placeholder = 'Type item name...',
  className = '',
  priceType = 'salePrice',
}: ItemSuggestProps) {
  const [suggestions, setSuggestions] = useState<ItemSuggestion[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const searchItems = useCallback(async (query: string) => {
    if (!tenantId || query.length < 1) {
      setSuggestions([])
      setShowDropdown(false)
      return
    }
    try {
      // v4.104: Search both inventory AND previous sale/purchase items
      const [invRes, salesRes] = await Promise.all([
        authFetch('/api/inventory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list', tenantId, search: query }),
        }),
        authFetch('/api/sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list', tenantId, search: query }),
        }),
      ])

      const allItems: ItemSuggestion[] = []
      const seenNames = new Set<string>()

      // From inventory
      if (invRes.ok) {
        const data = await invRes.json()
        for (const item of (data.items || [])) {
          const key = item.name.toLowerCase()
          if (!seenNames.has(key)) {
            seenNames.add(key)
            allItems.push({
              id: item.id,
              name: item.name,
              category: item.category,
              hsnCode: item.hsnCode,
              unit: item.unit,
              salePrice: item.salePrice,
              purchasePrice: item.purchasePrice,
              gstRate: item.gstRate,
              mrp: item.mrp,
              itemType: item.itemType,
              currentStock: item.currentStock,
              barcode: item.barcode || null,
            })
          }
        }
      }

      // From previous sales (extract item names from sale.items JSON)
      if (salesRes.ok) {
        const data = await salesRes.json()
        for (const sale of (data.sales || [])) {
          try {
            const saleItems = JSON.parse(sale.items || '[]')
            for (const sItem of saleItems) {
              if (sItem.name && sItem.name.toLowerCase().includes(query.toLowerCase())) {
                const key = sItem.name.toLowerCase()
                if (!seenNames.has(key)) {
                  seenNames.add(key)
                  allItems.push({
                    id: 'sale_' + key,
                    name: sItem.name,
                    category: sItem.category || null,
                    hsnCode: sItem.hsn || null,
                    unit: sItem.unit || 'PCS',
                    salePrice: sItem.rate || 0,
                    purchasePrice: 0,
                    gstRate: 0,
                    mrp: sItem.mrp || null,
                    itemType: 'SERVICE',
                    currentStock: 0,
                    barcode: null,
                  })
                }
              }
            }
          } catch {}
        }
      }

      const items = allItems.slice(0, 10)
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
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      searchItems(val)
    }, 100)
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
    }
  }

  const handleFocus = () => {
    if (value.length >= 1 && suggestions.length > 0) {
      setShowDropdown(true)
    } else if (value.length >= 1) {
      searchItems(value)
    }
  }

  return (
    <div className={`relative ${className}`}>
      {label && <Label className="text-sm text-muted-foreground block mb-1.5">{label}</Label>}
      <Input
        ref={inputRef}
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        placeholder={placeholder}
        className="h-10 text-base"
        autoComplete="off"
      />
      {showDropdown && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-[70] mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-60 overflow-y-auto"
        >
          {suggestions.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between border-b border-border/50 last:border-0 ${
                idx === highlightedIndex ? 'bg-accent' : ''
              }`}
              onMouseDown={(e) => {
                e.preventDefault()
                handleSelect(item)
              }}
            >
              <div className="flex flex-col">
                <span className="font-medium">{item.name}</span>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {item.barcode && <span>BAR: {item.barcode}</span>}
                  {item.hsnCode && <span>HSN: {item.hsnCode}</span>}
                  <span>Stock: {item.currentStock} {item.unit}</span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-sm font-semibold text-emerald-600">
                  {priceType === 'salePrice' ? item.salePrice : item.purchasePrice}
                </span>
                {item.category && (
                  <div className="text-xs text-muted-foreground">{item.category}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
