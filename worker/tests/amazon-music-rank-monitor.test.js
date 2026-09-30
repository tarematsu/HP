import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AMAZON_MUSIC_GROUP_KNOWN_KEY,
  AMAZON_MUSIC_TOP_STATE_KEY,
  continueAmazon100kScan,
  monitorAmazonTop500,
} from '../src/amazon-music-rank-monitor.js';

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return value; },
  };
}

function track(id, title, artist) {
  return {
    primaryText: { text: title },
    secondaryText: artist,
    primaryTextLink: { deeplink: `/tracks/${id}/${title}` },
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
      const page = pages[Math.min(pageIndex, pages.length - 1)];
      pageIndex += 1;
      return jsonResponse(page);
    }
    throw new Error(`Unexpected request: ${value}`);
  };
}

function top500Pages({ swap = false } = {}) {
  const ids = Array.from({ length: 500 }, (_, index) => `OTHER${String(index + 1).padStart(4, '0')}`);
  if (swap) [ids[10], ids[11]] = [ids[11], ids[10]];
  return Array.from({ length: 25 }, (_, page) => {
    const start = page * 20;
    return chartDocument(
      ids.slice(start, start + 20).map((id, offset) => track(id, `Song ${start + offset + 1}`, 'Other Artist')),
      page < 24 ? `page-${page + 2}` : null,
    );
  });
}

class FakeR2 {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    const value = this.values.get(key);
    if (value == null) return null;
    return {
      async json() { return JSON.parse(value); },
      async text() { return value; },
    };
  }

  async put(key, body) {
    this.values.set(key, String(body));
  }
}

class FakeDb {
  constructor() {
    this.runs = [];
  }

  prepare(sql) {
    const db = this;
    return {
      bindings: [],
      bind(...values) {
        this.bindings = values;
        return this;
      },
      async run() {
        db.runs.push({ sql, bindings: this.bindings });
        return { success: true };
      },
    };
  }
}

test('hourly top-500 monitor detects a ranking update even when no Sakamichi track is involved', async () => {
  const r2 = new FakeR2();
  const db = new FakeDb();
  const env = { PAGES_RESPONSE_R2: r2, MINUTE_DB: db };

  const initial = await monitorAmazonTop500(env, 1000, amazonFetch(top500Pages()));
  assert.equal(initial.initialized, true);
  assert.equal(initial.updated, false);
  assert.equal(initial.scanned_tracks, 500);
  assert.equal(db.runs.length, 0);

  const changed = await monitorAmazonTop500(env, 2000, amazonFetch(top500Pages({ swap: true })));
  assert.equal(changed.updated, true);
  assert.equal(changed.changed_positions, 2);
  assert.equal(db.runs.length, 1);
  assert.match(db.runs[0].sql, /amazon_music_chart_change_events/);

  const state = JSON.parse(r2.values.get(AMAZON_MUSIC_TOP_STATE_KEY));
  assert.equal(state.tracks.length, 500);
  assert.deepEqual(Object.keys(state.tracks[0]).sort(), ['amazon_music_id', 'rank']);
});

test('deep scan keeps detailed rank state only for Sakurazaka, Hinatazaka, and Nogizaka', async () => {
  const r2 = new FakeR2();
  const env = { PAGES_RESPONSE_R2: r2, MINUTE_DB: null };
  const fetchImpl = amazonFetch([
    chartDocument([
      track('SAKURA1', 'Sakura Song', '櫻坂46'),
      track('OTHER1', 'Other Song', 'Other Artist'),
      track('HINATA1', 'Hinata Song', '日向坂46'),
      track('NOGI1', 'Nogi Song', '乃木坂46'),
    ]),
  ]);

  const result = await continueAmazon100kScan(env, 3000, fetchImpl);
  assert.equal(result.complete, true);
  assert.equal(result.sakamichi_tracks_seen, 3);

  const known = JSON.parse(r2.values.get(AMAZON_MUSIC_GROUP_KNOWN_KEY));
  assert.deepEqual(known.tracks.map((item) => item.group_name).sort(), ['乃木坂46', '日向坂46', '櫻坂46']);
  assert.equal(known.tracks.some((item) => item.amazon_music_id === 'OTHER1'), false);
});