'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { STATE_CODES, validateGSTIN } from '@/lib/gst-utils'

interface GstinInputProps {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
}

export function GstinInput({ value, onChange, label, placeholder = 'Enter 15-character GSTIN' }: GstinInputProps) {
  const normalized = value.trim().toUpperCase()
  const validation = normalized.length === 15 ? validateGSTIN(normalized) : null
  const stateCode = normalized.slice(0, 2)
  const stateName = STATE_CODES[stateCode]

  return (
    <div className="min-w-0 space-y-1.5">
      <Label>{label}</Label>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value.toUpperCase().replace(/\\s/g, '').slice(0, 15))}
        placeholder={placeholder}
        maxLength={15}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={validation ? !validation.valid : undefined}
      />
      {normalized.length > 0 && (
        <p className={`text-xs ${validation ? (validation.valid ? 'text-emerald-600' : 'text-destructive') : 'text-muted-foreground'}`}>
          {validation
            ? validation.valid
              ? `GSTIN format and checksum valid · State: ${stateName || stateCode}`
              : validation.error
            : `Enter ${15 - normalized.length} more character${15 - normalized.length === 1 ? '' : 's'} to complete the GSTIN.`}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Format check only; registration status and party details are not fetched.
        {' '}
        <a
          href="https://services.gst.gov.in/services/searchtp"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline underline-offset-2"
        >
          Verify on the official GST Portal
        </a>
      </p>
    </div>
  )
}
