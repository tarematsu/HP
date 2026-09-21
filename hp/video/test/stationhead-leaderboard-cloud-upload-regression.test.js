import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');
const probeScript = read('../../native/src/sh_july19_stats_policy_fix.h');
const messagePolicy = read('../../native/src/sh_leaderboard_probe_message_policy.h');
const spool = read('../../native/src/stationhead_leaderboard_probe_spool.h');
const appMessages = read('../../native/src/app_messages.cpp');
const exchange = read('../../native/src/cloud_client_exchange.inc');
const cloudPayload = read('../../cloud/src/device_exchange_payload.ts');
const cloudProbe = read('../../cloud/src/stationhead_leaderboard_probe.ts');
const reportWorkflow = read('../../../.github/workflows/stationhead-leaderboard-probe-report.yml');

test('leaderboard probe sends only bounded data records to the native trusted-origin bridge', () => {
  assert.match(probeScript, /stationhead-leaderboard-probe:' \+ JSON\.stringify\(safe\)/);
  assert.match(probeScript, /body: String\(row\.body \|\| ''\)\.slice\(0, 65536\)/);
  assert.doesNotMatch(probeScript, /JSON\.stringify\(window\.__homepanelStationheadAuthHeaders\)/);
  assert.match(messagePolicy, /IsTrustedStationheadSource/);
  assert.match(messagePolicy, /CaptureProbeMessage/);
  assert.match(messagePolicy, /stationhead_leaderboard_probe_spool::Append/);
});

test('native probe spool is durable, bounded, and wakes the existing cloud client', () => {
  assert.match(spool, /stationhead-leaderboard-probe\.ndjson/);
  assert.match(spool, /kMaxProbeRecords = 20/);
  assert.match(spool, /kProbeUploadBatchSize = 8/);
  assert.match(spool, /MoveFileExW[\s\S]*MOVEFILE_REPLACE_EXISTING \| MOVEFILE_WRITE_THROUGH/);
  assert.match(appMessages, /case kStationheadLeaderboardProbeWakeMessage:[\s\S]*cloud_->RefreshNow\(\)/);
});

test('device exchange uploads probe records separately from sensor telemetry and acknowledges reported rows only', () => {
  assert.match(exchange, /stationhead_leaderboard_probe_spool::ReadBatch\(\)/);
  assert.match(exchange, /,\\"leaderboardProbe\\":\[/);
  assert.match(exchange, /GetNamedBoolean\(L"reported", false\)/);
  assert.match(exchange, /stationhead_leaderboard_probe_spool::Acknowledge\(accepted\)/);
  assert.match(cloudPayload, /leaderboardProbe\?: unknown/);
  assert.match(cloudPayload, /applyStationheadLeaderboardProbeInput/);
});

test('cloud keeps full redacted history in R2 and reports a bounded artifact without logging the body', () => {
  assert.match(cloudProbe, /diagnostics\/stationhead-leaderboard\/history\//);
  assert.match(cloudProbe, /diagnostics\/stationhead-leaderboard\/latest\.json/);
  assert.match(cloudProbe, /SECRET_KEY/);
  assert.match(cloudProbe, /MAX_REPORT_BODY_CHARS = 32_768/);
  assert.match(cloudProbe, /event_type: "stationhead-leaderboard-probe"/);
  assert.match(reportWorkflow, /actions\/upload-artifact@v4/);
  assert.match(reportWorkflow, /Response body is intentionally omitted from logs/);
  assert.doesNotMatch(reportWorkflow, /summary\.write\([^\n]*payload\.get\("body"/);
});
