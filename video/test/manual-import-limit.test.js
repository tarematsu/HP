import assert from 'node:assert/strict';
import test from 'node:test';

import { MANUAL_IMPORT_MAX_URLS } from '../src/manual-import-limits.js';
import { runManualImport } from '../src/manual-import.js';

function importRequest(count) {
  return new Request('https://example.com/api/admin/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sourceUrl: 'https://example.com/source',
      urls: Array.from({ length: count }, (_, index) => `https://cdn.example/${index}.mp4`)
    })
  });
}

test('manual imports reject more than 300 URLs even when MAX_VIDEOS is larger', async () => {
  const result = await runManualImport(importRequest(301), { MAX_VIDEOS: '2000' });

  assert.equal(MANUAL_IMPORT_MAX_URLS, 300);
  assert.equal(result.status, 413);
  assert.deepEqual(result.data, {
    ok: false,
    error: 'At most 300 URLs are allowed'
  });
});

test('a lower MAX_VIDEOS setting remains a stricter manual import cap', async () => {
  const result = await runManualImport(importRequest(201), { MAX_VIDEOS: '200' });

  assert.equal(result.status, 413);
  assert.deepEqual(result.data, {
    ok: false,
    error: 'At most 200 URLs are allowed'
  });
});
