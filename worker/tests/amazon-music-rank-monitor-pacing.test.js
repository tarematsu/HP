import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AMAZON_MUSIC_DEEP_SCAN_PACING_WINDOW_MS,
  scanAmazonChart,
} from '../src/amazon-music-rank-monitor.js';

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return value; },
  };
}

function track(id) {
  return {
    primaryText: { text: `Song ${id}` },
    secondaryText: 'Other Artist',
    primaryTextLink: { deeplink: `/tracks/${id}/song-${id}` },
  };
}

function chartDocument(items, next = null) {
  return {
    methods: [{
      template: {
        items,
        onCreated: next == null ? [] : [{
          url: `https://fe.mesk.skill.music.a2z.com/api/showChartsWidget?genreTitle=browsePanel&genreId=popularTracks&widgetId=top-songs&next=${encodeURIComponent(String(next))}`,
        }],
      },
    }],
  };
}

function amazonFetch(pages) {
  let pageIndex = 0;
  return async (url) => {
    const value = String(url);
    if (value.includes('/config.json?')) {
      return jsonResponse({
        accessToken: 'access',
        deviceId: 'device',
        sessionId: 'session',
        version: '1.0.11376.0',
        csrf: { token: 'csrf', ts: 123, rnd: 456 },
      });
    }
    if (value.endsWith('/api/showHome')) return jsonResponse({ methods: [] });
    if (value.includes('/api/showChartsWidget?')) {
      const page = pages[pageIndex];
      pageIndex += 1;
      return jsonResponse(page);
    }
    throw new Error(`Unexpected request: ${value}`);
  };
}

test('deep scan pacing window leaves headroom inside the 10-minute cron interval', () => {
  assert.equal(AMAZON_MUSIC_DEEP_SCAN_PACING_WINDOW_MS, 570_000);
});

test('paced chart scan distributes page starts across the configured window', async () => {
  const pages = Array.from({ length: 3 }, (_, page) => chartDocument(
    Array.from({ length: 20 }, (_, offset) => track(`P${page + 1}-${offset + 1}`)),
    page < 2 ? `page-${page + 2}` : null,
  ));

  let now = 0;
  const sleeps = [];
  const result = await scanAmazonChart(amazonFetch(pages), {
    startRank: 0,
    stopRank: 60,
    maxPages: 3,
    pacingWindowMs: 600,
    nowImpl: () => now,
    sleepImpl: async (milliseconds) => {
      sleeps.push(milliseconds);
      now += milliseconds;
    },
  });

  assert.equal(result.pages_scanned, 3);
  assert.equal(result.scanned_tracks, 60);
  assert.equal(result.pacing_window_ms, 600);
  assert.deepEqual(sleeps, [300, 300]);
  assert.equal(now, 600);
});
