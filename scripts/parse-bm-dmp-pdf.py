#!/usr/bin/env python3
"""
Parse BM DMP.pdf — Bakers Mart - DMP inventory
Deduplicate against existing 895 items already in the database
Import only NEW items (not already present)
"""
import subprocess, json, re

PDF_PATH = '/home/z/my-project/upload/BM DMP.pdf'
TENANT_ID = 'cmqs5f2aq0000nx013d9w55ka'  # Bakers Mart - DMP

print("=== Step 1: Parsing PDF ===")
result = subprocess.run(['pdftotext', '-layout', PDF_PATH, '-'], capture_output=True, text=True)
lines = result.stdout.split('\n')

items = []
for line in lines:
    line = line.strip()
    if not line:
        continue
    # Skip headers
    if any(skip in line for skip in ['Stock Inventory', 'bakersmartghy', 'Product', 'Sub Group', 
        'Inward', 'Outward', 'Closing Value', 'Opening', 'TOTAL', '(Stock In)', '(Stock Out)',
        '(INR)', 'Brand', 'Product ID']):
        continue

    # Parse line: Product  SubGroup  Brand  ProductID  Opening  Inward  Outward  Closing  ClosingValue
    # Product name can have spaces. Numbers are at the end.
    # Pattern: text... number_ID(4digits) number number number number number(comma)
    
    parts = line.split()
    if len(parts) < 6:
        continue

    # Find the Product ID (4-digit number like 0510)
    product_id_idx = None
    for i, p in enumerate(parts):
        if re.match(r'^\d{4}$', p):
            product_id_idx = i
            break
    
    if product_id_idx is None or product_id_idx < 1:
        continue

    # Product name = everything before the ID
    name = ' '.join(parts[:product_id_idx]).strip()
    product_id = parts[product_id_idx]
    
    # The rest should be: Opening Inward Outward Closing ClosingValue
    remaining = parts[product_id_idx + 1:]
    if len(remaining) < 4:
        continue

    # Parse numbers (remove commas)
    try:
        nums = []
        for r in remaining:
            r_clean = r.replace(',', '').replace('.00', '')
            try:
                nums.append(float(r_clean))
            except ValueError:
                break
        
        if len(nums) >= 4:
            opening = int(nums[0])
            inward = int(nums[1])
            outward = int(nums[2])
            closing = nums[3]
            closing_value = nums[4] if len(nums) > 4 else 0
            
            # Calculate purchase price from closing_value / closing
            purchase_price = round(closing_value / closing, 2) if closing > 0 else 0

            items.append({
                'name': name,
                'product_id': product_id,
                'opening': opening,
                'inward': inward,
                'outward': outward,
                'closing': int(closing),
                'closing_value': closing_value,
                'purchase_price': purchase_price,
            })
    except:
        continue

print(f"Parsed {len(items)} items from PDF")
print(f"First 3: {items[:3]}")
print(f"Last 3: {items[-3:]}")

# Step 2: Fetch existing inventory from API
print("\n=== Step 2: Fetching existing inventory ===")
import urllib.request
req = urllib.request.Request(
    f'https://carefree-success-production-7766.up.railway.app/api/inventory',
    data=json.dumps({"action": "list", "tenantId": TENANT_ID}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST"
)
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
        existing_items = data.get('items', [])
        existing_names = set(i['name'].strip().lower() for i in existing_items)
        print(f"Existing inventory: {len(existing_items)} items")
except Exception as e:
    print(f"Could not fetch existing inventory: {e}")
    print("Using empty set (all items will be treated as new)")
    existing_names = set()

# Step 3: Deduplicate
print("\n=== Step 3: Deduplicating ===")
seen_names = set()
new_items = []
skipped_existing = 0
duplicates_within = 0

for item in items:
    name_lower = item['name'].strip().lower()
    if name_lower in existing_names:
        skipped_existing += 1
        continue
    if name_lower in seen_names:
        duplicates_within += 1
        continue
    seen_names.add(name_lower)
    new_items.append(item)

print(f"Total parsed: {len(items)}")
print(f"Skipped (already in DB): {skipped_existing}")
print(f"Skipped (duplicates within PDF): {duplicates_within}")
print(f"NEW items to import: {len(new_items)}")

# Step 4: Build import payload
print("\n=== Step 4: Building import payload ===")
payload_items = []
for i, item in enumerate(new_items):
    payload_items.append({
        'id': f'bmdmp_new_{i+1:04d}',
        'name': item['name'].strip(),
        'sku': None,
        'barcode': item['product_id'],
        'hsnCode': item['product_id'],
        'unit': 'PCS',
        'category': 'Grocery',
        'brand': None,
        'itemType': 'FINISHED_PRODUCT',
        'purchasePrice': item['purchase_price'],
        'salePrice': 0,
        'mrp': 0,
        'openingStock': item['opening'],
        'currentStock': item['closing'],
        'minStock': 0,
        'gstRate': 0,
        'value': item['closing_value'],
        'tenantId': TENANT_ID,
    })

output_path = '/home/z/my-project/download/bm_dmp_new_items.json'
with open(output_path, 'w') as f:
    json.dump({
        'tenantId': TENANT_ID,
        'items': payload_items,
        'summary': {
            'total_parsed': len(items),
            'skipped_existing': skipped_existing,
            'duplicates_within_pdf': duplicates_within,
            'new_items': len(new_items),
        }
    }, f, indent=2)

print(f"\n=== Summary ===")
print(f"Total items parsed from PDF: {len(items)}")
print(f"Already in inventory (skipped): {skipped_existing}")
print(f"Duplicates within PDF (skipped): {duplicates_within}")
print(f"NEW items to import: {len(new_items)}")
print(f"Payload saved to: {output_path}")
if new_items:
    print(f"\nFirst 5 new items:")
    for item in new_items[:5]:
        print(f"  - {item['name']} | ID: {item['product_id']} | Closing: {item['closing']} | Value: ₹{item['closing_value']}")
    print(f"\nLast 5 new items:")
    for item in new_items[-5:]:
        print(f"  - {item['name']} | ID: {item['product_id']} | Closing: {item['closing']} | Value: ₹{item['closing_value']}")
