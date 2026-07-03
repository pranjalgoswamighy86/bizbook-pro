#!/usr/bin/env python3
"""Multiply all px values in the invoice CSS by 4"""
import re

FILE = '/home/z/my-project/src/components/modules/sale-register.tsx'

with open(FILE, 'r') as f:
    content = f.read()

# Find the CSS block (between <style> and </style> inside the printHtml template)
# Only multiply px values within the style section
def multiply_px(match):
    val = int(match.group(1))
    return f'{val * 4}px'

# Find the style section
style_start = content.find("font-family: 'Courier New'")
if style_start == -1:
    print("Could not find style section")
    exit(1)

# Find the end of style section (</style>)
style_end = content.find('</style>', style_start)
if style_end == -1:
    print("Could not find </style>")
    exit(1)

style_section = content[style_start:style_end]

# Replace all Npx values with N*4px
new_style = re.sub(r'(\d+)px', multiply_px, style_section)

# Replace in content
new_content = content[:style_start] + new_style + content[style_end:]

with open(FILE, 'w') as f:
    f.write(new_content)

print("Done — all px values multiplied by 4")
