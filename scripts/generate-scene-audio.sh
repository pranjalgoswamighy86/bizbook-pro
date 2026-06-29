#!/bin/bash
# Generate per-scene TTS audio for slideshow sync
set -e
cd /home/z/my-project/download/promo-video

declare -a SCENES=(
"Drowning in bills, inventory, and GST returns?"
"Meet BizBook Pro — India's smartest business software."
"GST-compliant invoicing in seconds. Auto CGST, SGST, IGST split."
"Real-time inventory with barcode scanning. Never run out of stock."
"Just scan any invoice — AI fills 12 fields automatically."
"GSTR-1, 3B, and 9 reports ready to file. Plus P and L, balance sheet, trial balance."
"Works offline. Your data stays on your device — even if our servers go down."
"Start free at tahigo dot in. Built by Tahigo International."
)

for i in "${!SCENES[@]}"; do
  NUM=$(printf "%02d" $((i+1)))
  echo "Generating scene $NUM..."
  z-ai tts -i "${SCENES[$i]}" -o "voiceover-scene-${NUM}.wav" --voice kazi --speed 1.05 --format wav 2>&1 | tail -1
done

echo ""
echo "✅ All 8 scene audio files generated"
ls -la voiceover-scene-*.wav
