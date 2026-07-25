#!/usr/bin/env python3
from pathlib import Path

path = Path('hp/cloud/src/radar_bundle.ts')
text = path.read_text(encoding='utf-8')
replacements = {
    '    return new Response(bufferedRecords(records, byteLength), {':
        '    const body = bufferedRecords(records, byteLength);\n    return new Response(body.buffer as ArrayBuffer, {',
    '  const response = bundleResponse(body, totalBytes, paths.length);':
        '  const response = bundleResponse(body.buffer as ArrayBuffer, totalBytes, paths.length);',
}
for old, new in replacements.items():
    if text.count(old) != 1:
        raise SystemExit(f'expected exactly one occurrence: {old!r}')
    text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
print('Radar bundle response bodies converted to ArrayBuffer')
