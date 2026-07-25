import assert from 'node:assert/strict';
import test from 'node:test';

import { expectAll, expectNone, readSource } from './helpers/source-contract.mjs';

test('HomePanel R2 cleanup preserves arbitrary object keys', () => {
  const workflow = readSource('.github/workflows/prune-homepanel-updates.yml');

  expectAll(workflow, [
    "jq -c '.result[]?.key'",
    'objects-before.jsonl',
    'objects-after.jsonl',
    'fromjson | select(startswith($prefix) | not)',
    'key="$(jq -r \'.\' <<< "$encoded_key")"',
    'all(.result[]?; .key | type == "string")',
  ]);
  expectNone(workflow, [
    "jq -r '.result[]?.key'",
    'objects-before.txt',
    'obsolete-keys.txt',
  ]);
  assert.match(workflow, /while IFS= read -r encoded_key/);
});
