import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboardParser = readFileSync(
  new URL('../../native/src/dashboard_data.cpp', import.meta.url),
  'utf8',
);
const environmentSections = readFileSync(
  new URL('../../native/src/renderer_panels/environment_sections.inc', import.meta.url),
  'utf8',
);

test('native weather panel replaces unavailable forecasts with a prominent outage state', () => {
  assert.match(
    dashboardParser,
    /if \(json::Text\(weather, L"__status", L"ok"\) == L"ok"\) \{/,
  );
  assert.match(
    environmentSections,
    /if \(nativeDashboard_\.weatherHours\.empty\(\)\) \{[\s\S]*TierFont\(FontTier::Large\)[\s\S]*L"障害中"[\s\S]*return;/,
  );
});
