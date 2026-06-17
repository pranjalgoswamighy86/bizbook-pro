'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authFetch } from '@/lib/auth-fetch'

interface PartySuggestion {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  gstNumber: string | null
  type: string
}

interface PartySuggestProps {
  tenantId: string | undefined
  value: string
  onChange: (value: string) => void
  onPartySelect: (party: PartySuggestion) => void
  label?: string
  placeholder?: string
  required?: boolean
  partyType?: 'SUPPLIER' | 'CUSTOMER' | 'BOTH'
  className?: string
}

export function PartySuggest({
  tenantId,
  value,
  onChange,
  onPartySelect,
  label = 'Party Name',
  placeholder = 'Type party name...',
  required = false,
  partyType,
  className = '',
}: PartySuggestProps) {
  const [suggestions, setSuggestions] = useState<PartySuggestion[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  const searchParties = useCallback(async (query: string) => {
    if (!tenantId || query.length < 1) {
      setSuggestions([])
      setShowDropdown(false)
      return
    }
    try {
      const res = await authFetch('/api/parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'search', tenantId, query }),
      })
      const data = await res.json()
      const filtered = partyType
        ? (data.suggestions || []).filter(
            (s: PartySuggestion) => s.type === partyType || s.type === 'BOTH'
          )
        : data.suggestions || []
      setSuggestions(filtered)
      setShowDropdown(filtered.length > 0)
      setHighlightedIndex(-1)
    } catch {
      setSuggestions([])
    }
  }, [tenantId, partyType])

  useEffect(() => {
    // Click outside to close dropdown
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

    // Debounce search
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      searchParties(val)
    }, 200)
  }

  const handleSelect = (party: PartySuggestion) => {
    onChange(party.name)
    onPartySelect(party)
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
      searchParties(value)
    }
  }

  return (
    <div className={`relative ${className}`}>
      {label && <Label>{label}{required && ' *'}</Label>}
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
          className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto"
        >
          {suggestions.map((party, idx) => (
            <button
              key={party.id}
              type="button"
              className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between ${
                idx === highlightedIndex ? 'bg-accent' : ''
              }`}
              onMouseDown={(e) => {
                e.preventDefault()
                handleSelect(party)
              }}
            >
              <div>
                <span className="font-medium">{party.name}</span>
                {party.phone && (
                  <span className="text-muted-foreground ml-2 text-xs">{party.phone}</span>
                )}
              </div>
              {party.gstNumber && (
                <span className="text-xs text-muted-foreground">GST: {party.gstNumber}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
