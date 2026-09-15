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
const layout = readFileSync(
  new URL('../../native/src/renderer_panels/layout_overrides.inc', import.meta.url),
  'utf8',
);

test('Plug Mini footer shows rounded integer watts without ON/OFF state', () => {
  assert.match(dashboardParser, /const double watts = NumberOrNaN\(item, L"watts"\)/);
  assert.match(
    dashboardParser,
    /std::to_wstring\(static_cast<int>\(std::round\(watts\)\)\) \+ L"W"/,
  );
  assert.doesNotMatch(
    dashboardParser,
    /PlugState|Contact|Motion|Presence|battery|json::Text\(item, L"power"|L"ON"|L"OFF"/,
  );
});

test('Plug Mini footer filters non-plug devices and parses only the four visible plugs', () => {
  assert.match(
    dashboardParser,
    /json::Text\(item, L"deviceType"\)\.find\(L"Plug"\) == std::wstring::npos/,
  );
  assert.match(
    dashboardParser,
    /index < devices\.Size\(\) && next\.size\(\) < 4/,
  );
  assert.match(
    dataSections,
    /const size_t plugDeviceCount = std::min<size_t>\(4, nativeDashboard_\.switchBotDevices\.size\(\)\);/,
  );
  assert.match(layout, /const int plugRowCount = boundedCount > 2 \? 2 : 1;/);
  assert.match(dataSections, /const int plugRow = static_cast<int>\(i \/ 2\);/);
  assert.match(dataSections, /const int plugColumn = static_cast<int>\(i % 2\);/);
  assert.match(
    layout,
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
