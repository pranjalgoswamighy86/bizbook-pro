'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface ValueSuggestProps {
  /** Pre-loaded list of suggestion values */
  suggestions: string[]
  /** Current input value */
  value: string
  /** Callback when input changes */
  onChange: (value: string) => void
  /** Label text */
  label?: string
  /** Placeholder text */
  placeholder?: string
  /** Whether the field is required */
  required?: boolean
  /** Minimum characters before showing suggestions (default: 1) */
  minChars?: number
  /** Additional CSS classes */
  className?: string
}

/**
 * ValueSuggest: A reusable autocomplete component for free-text fields
 * that suggests previously-entered values after typing 1-3 characters.
 * 
 * Unlike PartySuggest which fetches from API, ValueSuggest works with
 * a pre-loaded list of string values (e.g., departments, categories, brands).
 */
export function ValueSuggest({
  suggestions,
  value,
  onChange,
  label,
  placeholder = 'Type to see suggestions...',
  required = false,
  minChars = 1,
  className = '',
}: ValueSuggestProps) {
  const [filtered, setFiltered] = useState<string[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Filter suggestions based on current input
  const filterSuggestions = useCallback((query: string) => {
    if (query.length < minChars) {
      setFiltered([])
      setShowDropdown(false)
      return
    }
    const lowerQuery = query.toLowerCase()
    const matches = suggestions.filter(s =>
      s.toLowerCase().includes(lowerQuery)
    ).slice(0, 10) // Limit to 10 suggestions
    setFiltered(matches)
    setShowDropdown(matches.length > 0)
    setHighlightedIndex(-1)
  }, [suggestions, minChars])

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
    filterSuggestions(val)
  }

  const handleSelect = (suggestion: string) => {
    onChange(suggestion)
    setShowDropdown(false)
    setFiltered([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || filtered.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(prev => Math.min(prev + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault()
      handleSelect(filtered[highlightedIndex])
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
    } else if (e.key === 'Tab' && highlightedIndex >= 0) {
      handleSelect(filtered[highlightedIndex])
    }
  }

  const handleFocus = () => {
    if (value.length >= minChars) {
      filterSuggestions(value)
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
      {showDropdown && filtered.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-40 overflow-y-auto"
        >
          {filtered.map((suggestion, idx) => (
            <button
              key={suggestion}
              type="button"
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors ${
                idx === highlightedIndex ? 'bg-accent' : ''
              }`}
              onMouseDown={(e) => {
                e.preventDefault()
                handleSelect(suggestion)
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
