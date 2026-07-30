import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboardParser = readFileSync(
  new URL('../../native/src/dashboard_data.cpp', import.meta.url),
  'utf8',
);
const dataSections = readFileSync(
  new URL('../../native/src/renderer_panels/data_sections.inc', import.meta.url),
  'utf8',
);

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} is missing`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`${signature} has no closing brace`);
}

test('Plug Mini footer shows rounded integer watts without ON/OFF state', () => {
  const deviceState = functionBody(dashboardParser, 'std::wstring DeviceState');
  assert.match(deviceState, /state = L"--W";/);
  assert.match(
    deviceState,
    /swprintf_s\(buffer, L"%dW", static_cast<int>\(std::round\(watts\)\)\);/,
  );
  assert.doesNotMatch(deviceState, /json::Text\(item, L"power"/);
  assert.doesNotMatch(deviceState, /L"ON"|L"OFF"/);
});

test('Plug Mini footer filters non-plug devices and renders four plugs as a two-by-two grid', () => {
  assert.match(
    dashboardParser,
    /if \(type\.find\(L"Plug"\) == std::wstring::npos\) continue;/,
  );
  assert.match(
    dashboardParser,
    /index < devices\.Size\(\) && next\.switchBotDevices\.size\(\) < 8/,
  );
  assert.match(
    dataSections,
    /const size_t plugDeviceCount = std::min<size_t>\(4, nativeDashboard_\.switchBotDevices\.size\(\)\);/,
  );
  assert.match(dataSections, /const int plugRowCount = plugDeviceCount > 2 \? 2 : 1;/);
  assert.match(dataSections, /const int plugRow = static_cast<int>\(i \/ 2\);/);
  assert.match(dataSections, /const int plugColumn = static_cast<int>\(i % 2\);/);
  assert.match(
    dataSections,
    /plugLineHeight \* plugRowCount \+ plugRowGap \* \(plugRowCount - 1\)/,
  );
});

test('two-device rows are compact while single-device rows use the full footer width', () => {
  assert.match(dataSections, /const int rowStartIndex = plugRow \* 2;/);
  assert.match(
    dataSections,
    /const int devicesInRow =\s*std::min\(2, static_cast<int>\(plugDeviceCount\) - rowStartIndex\);/s,
  );
  assert.match(
    dataSections,
    /const int plugRowWidth =\s*devicesInRow == 2 \? plugRectWidth \* 80 \/ 100 : plugRectWidth;/s,
  );
  assert.match(
    dataSections,
    /const int plugRowLeft = plugRect\.left \+ \(plugRectWidth - plugRowWidth\) \/ 2;/,
  );
  assert.match(
    dataSections,
    /\(plugRowWidth - plugColumnGap \* \(devicesInRow - 1\)\) \/ devicesInRow/,
  );
});
