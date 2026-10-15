import assert from 'node:assert/strict';
import test from 'node:test';
import { nextViralArchiveProbe, advanceViralArchiveProbe, VIRAL_ARCHIVE_LANDMARKS } from '../src/spotify-japan-viral-archive.js';

test('daily and weekly Viral probes include older years, not just three dates near retirement', () => {
  assert.equal(VIRAL_ARCHIVE_LANDMARKS.daily[0], '2026-05-14');
  assert.equal(VIRAL_ARCHIVE_LANDMARKS.weekly[0], '2026-05-07');
  assert.ok(VIRAL_ARCHIVE_LANDMARKS.daily.includes('2020-05-14'));
  assert.ok(VIRAL_ARCHIVE_LANDMARKS.weekly.includes('2020-08-12'));
  assert.ok(VIRAL_ARCHIVE_LANDMARKS.daily.some(date => date.startsWith('2017')));
  assert.ok(VIRAL_ARCHIVE_LANDMARKS.weekly.some(date => date.startsWith('2017')));
});

for (const period of ['daily', 'weekly']) {
  test(`${period}: archive discovery checkpoints across all sampled years and eventually stops`, () => {
    const state = { archive_probed: true }; // Legacy flag may have been written by the previous collector.
    const seen = new Set();
    for (let i = 0; i < 250; i++) {
      const date = nextViralArchiveProbe(state, period);
      if (!date) break;
      assert.ok(date >= '2017-01-01');
      assert.ok(!seen.has(date), `duplicate ${period} probe: ${date}`);
      seen.add(date);
      advanceViralArchiveProbe(state, period);
    }
    assert.equal(nextViralArchiveProbe(state, period), null, 'exploration terminates without an infinite Queue loop');
    assert.ok(seen.size > 100, 'a full retrospective scans more than a few sample days');
    assert.ok([...seen].some(date => date.startsWith('2018')));
    assert.ok([...seen].some(date => date.startsWith('2021')));
    assert.ok([...seen].some(date => date.startsWith('2025')));
  });
}

test('a captured archive switches to history and rejects further archive probing', () => {
  const state = { archive_probe_index: 4, latest_chart_date: '2022-05-14', archive_search_complete: true };
  assert.equal(nextViralArchiveProbe(state, 'daily'), null);
});
