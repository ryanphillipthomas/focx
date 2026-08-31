import re
html = open('apps/connect/index.html').read()
m = re.search(r'<section class="sheet" data-figma-node="28:117, 31:117">.*?</section>', html, re.S)
print('=== Confirmation actions section ===')
print(m.group(0) if m else 'NOT FOUND')
print()
buttons = re.findall(r'<button[^>]*>[^<]*</button>', m.group(0)) if m else []
print(f'button count in section: {len(buttons)}')
for b in buttons:
    print(' -', b)
sheets = re.findall(r'<section class="sheet"[^>]*>', html)
print()
print(f'total .sheet sections on page: {len(sheets)}')
for s in sheets:
    print(' -', s)
