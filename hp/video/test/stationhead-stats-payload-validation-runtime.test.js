import assert from 'node:assert/strict';
import test from 'node:test';

function normalize(data) {
  const rawChart = Array.isArray(data?.chart_data) ? data.chart_data :
    (Array.isArray(data?.data?.chart_data) ? data.data.chart_data :
      (Array.isArray(data?.chartData) ? data.chartData :
        (Array.isArray(data?.data?.chartData) ? data.data.chartData : null)));
  return (rawChart || []).map(point => {
    const rawTimestamp = point?.ts ?? point?.timestamp ?? point?.date;
    const numericTimestamp = Number(rawTimestamp);
    let timestamp = Number.isFinite(numericTimestamp)
      ? numericTimestamp
      : Date.parse(String(rawTimestamp || ''));
    if (timestamp > 0 && timestamp < 10_000_000_000) timestamp *= 1000;
    const value = Number(point?.val ?? point?.value ?? point?.count);
    return Number.isFinite(timestamp) && timestamp > 0 &&
        Number.isFinite(value) && value >= 0
      ? { ts: timestamp, val: value }
      : null;
  }).filter(Boolean);
}

test('normalizes nested camelCase points with numeric strings and second timestamps', () => {
  assert.deepEqual(normalize({
    data: {
      chartData: [
        { timestamp: '1785250800', count: '12' },
        { date: '2026-07-29T00:00:00.000Z', value: 5 },
      ],
    },
  }), [
    { ts: 1785250800000, val: 12 },
    { ts: Date.parse('2026-07-29T00:00:00.000Z'), val: 5 },
  ]);
});

test('drops malformed and negative points instead of fabricating zeroes', () => {
  assert.deepEqual(normalize({ chart_data: [
    { ts: 'bad', val: 20 },
    { ts: 1785250800000, val: 'bad' },
    { ts: 1785250800000, val: -1 },
  ] }), []);
});
