import assert from 'node:assert/strict';
import test from 'node:test';

import { expectAll, expectNone, readSource } from './helpers/source-contract.mjs';

test('HomePanel R2 cleanup preserves arbitrary object keys and paginates', () => {
  const workflow = readSource('.github/workflows/prune-homepanel-updates.yml');

  expectAll(workflow, [
    "jq -c '.result[]?.key'",
    'objects-before.jsonl',
    'objects-after.jsonl',
    'fromjson as $key',
    'key="$(jq -r \'.\' <<< "$encoded_key")"',
    'all(.result[]?; .key | type == "string")',
    'split("/") | map(@uri) | join("/")',
    "next_cursor=\"$(jq -r '.result_info.cursor // empty' <<< \"$response\")\"",
    '[[ -n "$next_cursor" ]] || break',
    '[[ "$next_cursor" != "$cursor" ]]',
    'cursor="$next_cursor"',
  ]);
  expectNone(workflow, [
    "jq -r '.result[]?.key'",
    'objects-before.txt',
    'obsolete-keys.txt',
    '.result_info.is_truncated',
    "IFS='/' read -r -a segments",
  ]);
  assert.match(workflow, /while IFS= read -r encoded_key/);
});

test('HomePanel R2 cleanup does not delete a concurrently uploaded newer release', () => {
  const workflow = readSource('.github/workflows/prune-homepanel-updates.yml');

  expectAll(workflow, [
    "--arg releases_prefix 'updates/releases/'",
    '--arg current_version "$current_version"',
    '($key | ltrimstr($releases_prefix) | split("/")[0]) as $version',
    '($version | test("^[0-9]{10}$") | not) or $version <= $current_version',
  ]);
});
