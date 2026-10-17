import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { buildObservabilityTriage } from '../.github/scripts/observability-issue-triage.mjs';

test('storage meters sum per-bucket observations and fail closed on missing evidence', () => {
  const result = spawnSync('python3', ['-c', String.raw`
import contextlib, io, json, sys, tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, '.github/scripts')
import cloudflare_free_tier_audit as audit

def sample(bucket, at, payload, metadata=0):
    return {'dimensions': {'bucketName': bucket, 'datetime': at}, 'max': {'payloadSize': payload, 'metadataSize': metadata}}
a = sample('a', '2026-10-17T10:00:00Z', 100, 10)
b = sample('b', '2026-10-17T11:00:00Z', 200, 20)
partial = sample('a', '2026-10-17T12:00:00Z', None)
result = audit.r2_storage_snapshot([a, b, partial], ['a', 'b'])
assert result['bytes'] == 330, result
assert result['buckets'][0]['observedAt'] == '2026-10-17T10:00:00Z'
assert result['missingBuckets'] == []
assert audit.r2_storage_snapshot([a, b], ['a', 'b', 'missing'])['bytes'] is None
assert audit.r2_storage_snapshot([])['bytes'] is None
assert audit.latest_size([], 'date', 'byteCount') is None
assert audit.latest_size([{'dimensions': {'date': '2026-10-17'}, 'max': {'byteCount': None}}], 'date', 'byteCount') is None
assert audit.latest_size([{'dimensions': {'date': '2026-10-17'}, 'max': {'byteCount': 0}}], 'date', 'byteCount') == 0
for value in [None, True, -1, 'bad', float('nan'), float('inf')]:
    assert audit.storage_bytes(value) is None
assert audit.storage_bytes(0) == 0
assert audit.aggregate({})['doStoredBytes'] is None
assert audit.aggregate({})['r2StoredBytes'] is None
sql = [{'dimensions': {'namespaceId': ns, 'datetime': at}, 'max': {'storedBytes': size}}
       for ns, at, size in [('a', '2026-10-17T10:00:00Z', 100), ('a', '2026-10-17T11:00:00Z', 200),
                            ('b', '2026-10-17T10:30:00Z', 300)]]
snapshot = audit.do_storage_snapshot(sql)
assert snapshot['bytes'] == 500 and snapshot['namespaceCount'] == 2
assert snapshot['observedFrom'] == '2026-10-17T10:30:00Z'
assert snapshot['observedTo'] == '2026-10-17T11:00:00Z'
assert audit.do_storage_snapshot([])['bytes'] is None
assert audit.do_storage_snapshot([{'dimensions': {'namespaceId': 'a', 'datetime': 'now'}, 'max': {'storedBytes': None}}])['bytes'] is None

# Exercise the production report writer and exit status without credentials/API.
row = {'r2storage': [a, b, partial], 'doStorage': [{'dimensions': {'namespaceId': 'namespace-a', 'datetime': '2026-10-17T12:00:00Z'}, 'max': {'storedBytes': 0}}],
       'kvStorage': [{'dimensions': {'date': '2026-10-17'}, 'max': {'byteCount': 0}}]}
with tempfile.TemporaryDirectory() as directory:
    out = Path(directory)
    with patch.multiple(audit, TOKEN='test', ACCOUNT='test', CONFIGS=('test',), WORKER='test',
                        DO_BINDINGS=('test',), OUT=out), \
         patch.object(audit, 'configured_resources', return_value=({'queue'}, {'a','b'})), \
         patch.object(audit, 'queue_names_by_id', return_value=({}, None)), \
         patch.object(audit, 'api', side_effect=lambda _: {'data': {'viewer': {'accounts': [row]}}}), \
         patch.dict('os.environ', {'GITHUB_STEP_SUMMARY': str(out/'step.md')}), \
         contextlib.redirect_stdout(io.StringIO()):
        assert audit.main() == 0
        report = json.loads((out/'free-tier-usage.json').read_text())
        assert report['actualUsage']['r2StoredBytes'] == 330
        assert '2026-10-17T10:00:00Z' in (out/'summary.md').read_text()
        row['r2storage'] = []
        assert audit.main() == 1
        report = json.loads((out/'free-tier-usage.json').read_text())
        assert report['actualUsage']['r2StoredBytes'] is None
        assert 'r2StoredBytes' in report['unavailableMetrics']
        assert '| r2StoredBytes | UNKNOWN | UNKNOWN |' in (out/'summary.md').read_text()
        row['r2storage'] = [sample('a', '2026-10-17T12:00:00Z', 0), sample('b', '2026-10-17T12:00:00Z', 0)]
        assert audit.main() == 0
        assert json.loads((out/'free-tier-usage.json').read_text())['actualUsage']['r2StoredBytes'] == 0
print('storage sample regression checks passed')
`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /storage sample regression checks passed/);
});


test('Issue triage names unavailable storage meters instead of showing a timestamp as evidence', () => {
  const triage = buildObservabilityTriage({
    outcomes: { daily: 'success', freeTier: 'failure', contract: 'success', d1Insights: 'success', query: 'success', telemetry: 'success', r2Collection: 'success' },
    summaries: { publicHealth: '| endpoint | success | 200 OK |', freeTier: '## Budgets\n\n- Generated: today\n\n| Metric | Actual | State |\n|---|---|---|\n| r2StoredBytes | UNKNOWN | UNKNOWN |' },
    activeDeployments: { worker: { status: 'active', deployment_id: 'deployment', version_ids: ['version'] } },
  });
  assert.match(triage, /r2StoredBytes — measurement unavailable/);
});
