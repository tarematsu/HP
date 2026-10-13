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

test('HomePanel R2 cleanup retains in-flight release assets after consecutive merges', () => {
  const workflow = readSource('.github/workflows/prune-homepanel-updates.yml');

  expectAll(workflow, [
    "--arg releases_prefix 'updates/releases/'",
    '--arg current_version "$current_version"',
    '($key | ltrimstr($releases_prefix) | split("/")[0]) as $version',
    '$version <= $current_version',
    "retention_cutoff=\"$(TZ=Asia/Tokyo date -d '72 hours ago' +%y%m%d%H%M)\"",
    'LC_ALL=C sort -u | tail -n 10',
    '--arg retention_cutoff "$retention_cutoff"',
    '--argjson retained_versions "$recent_versions_json"',
    '$version < $retention_cutoff',
    '(($retained_versions | index($version)) == null)',
    'obsolete_keys objects-before.jsonl > obsolete-keys.jsonl',
    'obsolete_keys objects-after.jsonl',
  ]);
  assert.match(workflow, /(\$version \| test\("\^\[0-9\]\{10\}\$"\) \| not)/);
  assert.match(workflow, /(\$key \| startswith\(\$current_prefix\) \| not)/);
});

test('native release publishes immutable binaries before switching latest manifest', () => {
  const workflow = readSource('.github/workflows/native-windows-build.yml');
  const publishStart = workflow.indexOf('      - name: Upload update assets to R2');
  const publishEnd = workflow.indexOf('      - name: Trigger immediate update rollout', publishStart);
  assert.ok(publishStart >= 0 && publishEnd > publishStart);
  const publish = workflow.slice(publishStart, publishEnd);
  for (const file of [
    'HomePanel.exe', 'HomePanelUpdater.exe', 'WebView2Loader.dll',
    'update-manifest.json',
  ]) {
    assert.ok(
      publish.indexOf('"updates/releases/$version/' + file + '"') <
        publish.indexOf('"updates/latest/update-manifest.json"'),
      file + ' must be uploaded before latest manifest',
    );
  }
  assert.match(workflow, /concurrency:[\s\S]*?queue: max/);
});
