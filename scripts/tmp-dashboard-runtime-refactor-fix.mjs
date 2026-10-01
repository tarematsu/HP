import { readFileSync, writeFileSync } from 'node:fs';

function edit(path, transform) {
  const before = readFileSync(path, 'utf8');
  const after = transform(before);
  if (after === before) {
    console.log(`unchanged ${path}`);
    return;
  }
  writeFileSync(path, after);
  console.log(`updated ${path}`);
}

function replaceAll(source, replacements) {
  let value = source;
  for (const [from, to] of replacements) {
    if (from instanceof RegExp) value = value.replace(from, to);
    else value = value.split(from).join(to);
  }
  return value;
}

edit('site/public/dashboard-chart-runtime.js', (source) => replaceAll(source, [[
  "if (typeof window !== 'undefined') {",
  "if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && typeof window.removeEventListener === 'function') {",
]]));

edit('site/public/spotify.js', (source) => replaceAll(source, [[
  /observeDashboardChartResize\(element\('spotifyView'\), \(\) => \{\n  if \(latestCharts\) renderCharts\(latestCharts\.trend, latestCharts\.artistChart\);\n\}, \{ delay: 220, enabled: \(\) => Boolean\(latestCharts\) \}\);/,
  "if (typeof document !== 'undefined') {\n  observeDashboardChartResize(element('spotifyView'), () => {\n    if (latestCharts) renderCharts(latestCharts.trend, latestCharts.artistChart);\n  }, { delay: 220, enabled: () => Boolean(latestCharts) });\n}",
]]));

edit('site/tests/chart-paint-stability.test.js', (source) => replaceAll(source, [
  ["assert.match(rankingChart, /function drawMissingBand\\(/);", "assert.match(rankingChart, /dashboardMissingIndexBands/);"],
  ["assert.match(rankingChart, /drawMissingBand\\(context, model\\.weeks, positions, area\\)/);", "assert.match(rankingChart, /drawDashboardMissingBands/);"],
]));

edit('site/tests/dashboard-chart-comparison.test.js', (source) => replaceAll(source, [
  ["assert.match(source, /const jstTime = new Intl\\.DateTimeFormat/);\n  assert.match(source, /timeZone: 'Asia\\/Tokyo'/);", "assert.match(source, /JST_TIME_HM/);"],
  ["jstTime\\.format", "JST_TIME_HM\\.format"],
  ["assert.match(source, /new ResizeObserver/);\n  assert.match(source, /observer\\.observe\\(canvas\\)/);", "assert.match(source, /observeDashboardChartResize/);\n  assert.doesNotMatch(source, /new ResizeObserver/);"],
]));

edit('site/tests/dashboard-current-enhancements.test.js', (source) => replaceAll(source, [
  ["assert.match(chart, /timeZone: 'Asia\\/Tokyo'/);", "assert.match(chart, /JST_TIME_HM/);"],
  ["jstTime\\.format", "JST_TIME_HM\\.format"],
]));

edit('site/tests/hinata-tab.test.js', (source) => replaceAll(source, [[
  "assert.match(runtime, /appendLegend\\('再生数増加', STREAM_BAR_COLOR/);",
  "assert.match(runtime, /appendDashboardLegendItem\\('再生数増加', STREAM_BAR_COLOR/);",
]]));

edit('site/tests/history-known-missing-period.test.js', (source) => replaceAll(source, [
  ["assert.match(chartSource, /rgba\\(100, 107, 116, \\.16\\)/);", "assert.match(chartSource, /dashboardMissingIndexBands/);\n  assert.match(chartSource, /drawDashboardMissingBands/);"],
  ["assert.match(chartSource, /appendLegend\\('欠測'/);", "assert.match(chartSource, /appendDashboardLegendItem\\('欠測'/);"],
]));

edit('site/tests/history-ranking-trackcount-display.test.js', (source) => replaceAll(source, [
  ["assert.match(rankingChart, /function drawMissingBand\\(context, weeks, positions, area\\)/);", "assert.match(rankingChart, /dashboardMissingIndexBands/);"],
  ["assert.match(rankingChart, /const hasMissingBand = drawMissingBand\\(context, model\\.weeks, positions, area\\)/);", "assert.match(rankingChart, /const hasMissingBand = drawDashboardMissingBands/);"],
  ["assert.match(rankingChart, /context\\.fillStyle = 'rgba\\(100, 107, 116, \\.16\\)'/);", "assert.match(rankingChart, /DASHBOARD_MISSING_KEY/);"],
  ["assert.match(rankingChart, /appendLegend\\('欠測', 'rgba\\(100, 107, 116, \\.55\\)'/);", "assert.match(rankingChart, /appendDashboardLegendItem\\('欠測', DASHBOARD_MISSING_KEY/);"],
]));

edit('site/tests/ohisama-missing-periods.test.js', (source) => replaceAll(source, [
  ["assert.match(runtime, /const MISSING_FILL = 'rgba\\(100, 107, 116, \\.16\\)'/);", "assert.match(runtime, /dashboardMissingGapBands/);"],
  ["assert.match(runtime, /const MISSING_KEY = 'rgba\\(100, 107, 116, \\.55\\)'/);", "assert.match(runtime, /DASHBOARD_MISSING_KEY/);"],
  ["assert.match(runtime, /gap <= DAY_MS \\* 1\\.5/);", "assert.match(runtime, /maxGap: DAY_MS \\* 1\\.5/);"],
  ["assert.match(runtime, /context\\.fillRect\\(left, area\\.top, Math\\.max\\(1, right - left\\), area\\.height\\)/);", "assert.match(runtime, /drawDashboardMissingBands/);"],
  ["assert.match(runtime, /appendLegend\\('欠測', MISSING_KEY, 'period-missing-band'\\)/);", "assert.match(runtime, /appendDashboardLegendItem\\('欠測', DASHBOARD_MISSING_KEY/);"],
]));

edit('site/tests/pages-further-regressions.test.js', (source) => {
  let value = source;
  value = value.replace(
    "  const broadcasts = readFileSync(new URL('../public/history/history-broadcasts.js', import.meta.url), 'utf8');\n",
    "  const broadcasts = readFileSync(new URL('../public/history/history-broadcasts.js', import.meta.url), 'utf8');\n  const dashboardTime = readFileSync(new URL('../public/dashboard-time.js', import.meta.url), 'utf8');\n",
  );
  value = replaceAll(value, [
    ["assert.match(broadcasts, /timeZone: 'Asia\\/Tokyo'/);", "assert.match(broadcasts, /JST_DATE_EN_CA/);\n  assert.match(dashboardTime, /timeZone: 'Asia\\/Tokyo'/);"],
    ["jstDay\\.format", "JST_DATE_EN_CA\\.format"],
  ]);
  return value;
});

edit('site/tests/pages-runtime-dedup.test.js', (source) => replaceAll(source, [
  ["assert.match(rankingChart, /function drawMissingBand\\(/);", "assert.match(rankingChart, /dashboardMissingIndexBands/);"],
  ["assert.match(rankingChart, /context\\.fillRect\\(left, area\\.top/);", "assert.match(rankingChart, /drawDashboardMissingBands/);"],
]));

edit('site/tests/period-display-member-fixes.test.js', (source) => replaceAll(source, [[
  "assert.match(periodChart, /appendLegend\\('再生数増加'/);",
  "assert.match(periodChart, /appendDashboardLegendItem\\('再生数増加'/);",
]]));

edit('site/tests/spotify-tab.test.js', (source) => replaceAll(source, [
  ["dashboard-chart-canvas\\.js\\?v=20261001\\.1", "dashboard-chart-canvas\\.js\\?v=20261001\\.2"],
  ["assert.match(runtime, /prepareDashboardCanvas/);", "assert.match(runtime, /prepareDashboardCanvas/);\n  assert.match(runtime, /observeDashboardChartResize/);"],
]));

console.log('temporary dashboard runtime refactor fixes applied');
