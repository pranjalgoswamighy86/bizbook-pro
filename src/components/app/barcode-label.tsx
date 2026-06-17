'use client'

import { generateBarcodeSvg } from '@/lib/barcode'

interface BarcodeLabelProps {
  name: string
  barcode: string
  price?: number
  currency?: string
  className?: string
}

export function BarcodeLabel({ name, barcode, price, currency = '₹', className = '' }: BarcodeLabelProps) {
  const barcodeSvg = generateBarcodeSvg(barcode, { width: 180, height: 50, showText: true, fontSize: 10 })

  return (
    <div className={`barcode-label inline-flex flex-col items-center border border-gray-300 rounded p-3 bg-white print:border-black ${className}`} style={{ width: 220, minHeight: 120 }}>
      <p className="text-xs font-semibold text-black text-center truncate w-full" style={{ maxWidth: 200 }}>{name}</p>
      {price !== undefined && price > 0 && (
        <p className="text-sm font-bold text-black mt-1">{currency}{price.toLocaleString('en-IN')}</p>
      )}
      <div
        className="mt-1"
        dangerouslySetInnerHTML={{ __html: barcodeSvg }}
      />
    </div>
  )
}

/**
 * Print a barcode label in a new window
 */
export function printBarcodeLabel(name: string, barcode: string, price?: number, currency?: string) {
  const svg = generateBarcodeSvg(barcode, { width: 220, height: 55, showText: true, fontSize: 11 })

  const printWindow = window.open('', '_blank', 'width=400,height=300')
  if (!printWindow) return

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Barcode Label</title>
      <style>
        @page { margin: 5mm; size: 80mm 40mm; }
        body { margin: 0; padding: 8px; font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
        .label { text-align: center; border: 1px solid #000; padding: 8px; border-radius: 4px; }
        .name { font-size: 11px; font-weight: bold; margin-bottom: 4px; }
        .price { font-size: 14px; font-weight: bold; margin-bottom: 4px; }
        @media print { body { padding: 0; } .label { border: 1px solid #000; } }
      </style>
    </head>
    <body>
      <div class="label">
        <div class="name">${name}</div>
        ${price !== undefined && price > 0 ? `<div class="price">${currency || '₹'}${price.toLocaleString('en-IN')}</div>` : ''}
        ${svg}
      </div>
      <script>
        window.onload = function() { window.print(); window.close(); }
      </script>
    </body>
    </html>
  `)
  printWindow.document.close()
}
