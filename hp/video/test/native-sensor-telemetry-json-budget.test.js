import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const source = filename => readFileSync(
  new URL('../../native/src/' + filename, import.meta.url), 'utf8');
const sensors = source('sensors.cpp');
const outbox = source('sensors_outbox.cpp');
const serializer = sensors.slice(sensors.indexOf('std::string EscapeJson('),
  sensors.indexOf('bool ConfigurePort('));
const builder = outbox.slice(outbox.indexOf('std::string SensorHub::BuildTelemetryPayload('),
  outbox.indexOf('void SensorHub::ApplyTelemetryReceipt('));

test('telemetry uses one reserved string buffer instead of stream formatting', () => {
  assert.ok(serializer.startsWith('std::string EscapeJson('));
  assert.ok(builder.startsWith('std::string SensorHub::BuildTelemetryPayload('));
  assert.match(builder, /std::min<size_t>\(60, outbox_\.size\(\)\)/);
  assert.match(builder, /body\.reserve\(160 \+ escapedId\.size\(\) \+ escapedVersion\.size\(\) \+ count \* 208\)/);
  assert.match(builder, /AppendInteger\(body, outbox_\.size\(\)\)/);
  assert.match(builder, /body \+= SampleJson\(outbox_\[i\]\)/);
  assert.doesNotMatch(builder, /std::ostringstream|std::stringstream|std::to_string/);
  assert.match(builder, /std::lock_guard lock\(mutex_\)/);
});

test('compiled production telemetry JSON preserves schema, escaping and 60-sample cap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'native-telemetry-json-'));
  try {
    const program = "#include <algorithm>\n#include <charconv>\n#include <cmath>\n#include <cstdint>\n#include <deque>\n#include <iostream>\n#include <mutex>\n#include <stdexcept>\n#include <string>\nnamespace hp {\nstruct SensorHub {\n  struct Sample {\n    uint64_t sequence = 0;\n    int64_t observedAt = 0;\n    int co2 = 0;\n    double temperature = 0;\n    double humidity = 0;\n    double temperatureCorrected = 0;\n    double humidityCorrected = 0;\n  };\n  mutable std::mutex mutex_;\n  std::deque<Sample> outbox_;\n  std::string BuildTelemetryPayload(const std::wstring&, const std::string&);\n};\nstd::string WideToUtf8(const std::wstring& value) {\n  return std::string(value.begin(), value.end());\n}\nnamespace {\n" + '\n' + serializer + '\n' + "\n}\n" + builder + "\n}\nint main() {\n  hp::SensorHub hub;\n  std::cout << hub.BuildTelemetryPayload(L\"device\", \"v1\") << '\\n';\n  for (int i = 0; i < 61; ++i) {\n    hp::SensorHub::Sample sample{};\n    sample.sequence = static_cast<uint64_t>(i + 1);\n    sample.observedAt = 1700000000000LL + i * 60000;\n    sample.co2 = 600 + i;\n    sample.temperature = 23.4;\n    sample.humidity = 47.6;\n    sample.temperatureCorrected = 23.4;\n    sample.humidityCorrected = 47.6;\n    hub.outbox_.push_back(sample);\n  }\n  std::cout << hub.BuildTelemetryPayload(L\"device\", \"v1\") << '\\n';\n  std::string awkward;\n  awkward.push_back('\"');\n  awkward.push_back('\\\\');\n  awkward.push_back('\\n');\n  std::cout << hub.BuildTelemetryPayload(L\"d\", awkward) << '\\n';\n}\n";
    writeFileSync(join(dir, 'test.cpp'), program);
    execFileSync('g++', ['-std=c++20', '-O2', '-Wall', '-Wextra', '-Werror',
      join(dir, 'test.cpp'), '-o', join(dir, 'test')]);
    const stdout = execFileSync(join(dir, 'test'), { encoding: 'utf8' });
    const records = stdout.trim().split('\n').map(text => JSON.parse(text));
    assert.equal(records.length, 3);
    assert.deepEqual(records[0], {
      deviceId: 'device', appVersion: 'v1', stationheadOk: false,
      outboxCount: 0, samples: [],
    });
    assert.equal(records[1].outboxCount, 61);
    assert.equal(records[1].samples.length, 60);
    assert.equal(records[1].samples[0].sequence, 1);
    assert.equal(records[1].samples.at(-1).sequence, 60);
    assert.equal(records[1].samples[0].temperature, 23.4);
    assert.equal(records[2].appVersion, '"\\\n');
    assert.equal(records[2].deviceId, 'd');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
