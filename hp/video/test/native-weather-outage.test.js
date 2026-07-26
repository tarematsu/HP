import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboardHeader = readFileSync(
  new URL('../../native/src/dashboard_data.h', import.meta.url),
  'utf8',
);
const dashboardParser = readFileSync(
  new URL('../../native/src/dashboard_data.cpp', import.meta.url),
  'utf8',
);
const environmentSections = readFileSync(
  new URL('../../native/src/renderer_panels/environment_sections.inc', import.meta.url),
  'utf8',
);

test('native weather panel replaces stale forecasts with a prominent outage state', () => {
  assert.match(dashboardHeader, /bool weatherOutage = false;/);
  assert.match(
    dashboardParser,
    /const std::wstring weatherStatus = json::Text\(weather, L"__status", L"ok"\);/,
  );
  assert.match(dashboardParser, /next\.weatherOutage = weatherStatus != L"ok";/);
  assert.match(
    environmentSections,
    /if \(nativeDashboard_\.weatherOutage\) \{[\s\S]*TierFont\(FontTier::Large\)[\s\S]*L"障害中"[\s\S]*return;/,
  );
});
