import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const outbox = readFileSync(
  new URL('../../native/src/sensors_outbox.cpp', import.meta.url), 'utf8');

function receiptSection() {
  const start = outbox.indexOf('void SensorHub::ApplyTelemetryReceipt(');
  assert.ok(start >= 0);
  return outbox.slice(start);
}

test('unchanged telemetry acknowledgements skip copying and rebuilding the outbox', () => {
  const body = receiptSection();
  const scan = body.indexOf('bool needsOutboxRewrite = false;');
  const fast = body.indexOf('if (!needsOutboxRewrite) {');
  const copy = body.indexOf('std::deque<Sample> updated = outbox_;');
  const mutation = body.indexOf('std::erase_if(updated,');
  assert.ok(scan >= 0 && fast > scan && copy > fast && mutation > copy);
  assert.match(body, /for \(const Sample& sample : outbox_\)/);
  assert.match(body, /std::binary_search\(acknowledgedSequences.begin\(\),\s*acknowledgedSequences.end\(\), sample.sequence\)/);
  assert.match(body, /nextUnchangedSequence > kMaxTelemetrySequence/);
  assert.match(body, /sample.sequence < nextUnchangedSequence/);
  assert.match(body, /if \(!needsOutboxRewrite\) \{[\s\S]*?AtomicWriteText\(outboxAckPath_, std::to_string\(persistedAck\)\)[\s\S]*?acknowledgedSequence_ = std::max\(acknowledgedSequence_, persistedAck\);[\s\S]*?nextSequence_ = std::max\(nextSequence_, nextUnchangedSequence\);[\s\S]*?return;/);
  assert.match(body, /if \(\(removed \|\| rebased\) && !RewriteOutboxLocked\(updated\)\)/);
  assert.match(body, /if \(removed \|\| rebased\) outbox_ = std::move\(updated\)/);
});

test('fast-path and transactional path agree about acknowledgements, rebasing and sequence exhaustion', () => {
  const limit = 9007199254740990;
  const baseline = (records, acknowledged, highWater) => {
    const persisted = Math.max(highWater, acknowledged.length ? acknowledged.at(-1) : highWater);
    let next = persisted + 1;
    let changed = false;
    for (const record of records) {
      if (acknowledged.includes(record)) { changed = true; continue; }
      if (next > limit) return { exhausted: true, changed };
      if (record < next) changed = true;
      next = (record >= limit) ? limit + 1 : record + 1;
    }
    return { exhausted: false, changed, next };
  };
  const shouldCopy = (records, acknowledged, highWater) => {
    const persisted = Math.max(highWater, acknowledged.length ? acknowledged.at(-1) : highWater);
    let next = persisted + 1;
    for (const record of records) {
      if (acknowledged.includes(record) || next > limit || record < next)
        return true;
      next = record >= limit ? limit + 1 : record + 1;
    }
    return false;
  };
  const cases = [
    { records: [], acknowledged: [], highWater: 100, copy: false },
    { records: [101, 102, 103], acknowledged: [], highWater: 100, copy: false },
    { records: [101, 102, 103], acknowledged: [101], highWater: 100, copy: true },
    { records: [101, 102, 103], acknowledged: [999], highWater: 100, copy: true },
    { records: [100, 101, 102], acknowledged: [], highWater: 100, copy: true },
    { records: [101, 105, 110], acknowledged: [], highWater: 100, copy: false },
    { records: [limit], acknowledged: [], highWater: limit, copy: true },
  ];
  for (const item of cases) {
    assert.equal(shouldCopy(item.records, item.acknowledged, item.highWater),
                 item.copy, JSON.stringify(item));
    const result = baseline(item.records, item.acknowledged, item.highWater);
    if (!item.copy) {
      assert.equal(result.changed, false);
      assert.equal(result.exhausted, false);
    }
  }
});

test('sensor collection and receipt writes maintain their existing persistence cadence', () => {
  const body = receiptSection();
  assert.match(body, /persistedAck > acknowledgedSequence_/);
  assert.match(body, /nextSequence_ = std::max\(nextSequence_, candidate\)/);
  assert.match(body, /Failed to persist telemetry outbox update; retaining the existing outbox/);
  assert.match(body, /Rebased[\s\S]*telemetry samples above the server sequence high-water mark/);
  assert.match(outbox, /bool SensorHub::AppendOutbox\(const Sample& sample\)/);
  assert.match(outbox, /HANDLE file = CreateFileW\(outboxPath_\.c_str\(\), FILE_APPEND_DATA/);
});
