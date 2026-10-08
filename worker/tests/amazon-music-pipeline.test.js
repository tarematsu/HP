import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AMAZON_MUSIC_PIPELINE_STATE_KEY,
  checkAmazonUpdateAndQueue100k,
  continueQueuedAmazon100kScan,
} from '../src/amazon-music-pipeline.js';
import { pagesR2ResponseKey } from '../src/pages-response-r2.js';

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

function top500Pages() {
  const ids = Array.from({ length: 500 }, (_, index) => `OTHER${String(index + 1).padStart(4, '0')}`);
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

test('hourly top-500 check bootstraps one 100k scan and stays idle when unchanged', async () => {
  const r2 = new FakeR2();
  const env = { PAGES_RESPONSE_R2: r2, MINUTE_DB: null };

  const initial = await checkAmazonUpdateAndQueue100k(env, 1000, amazonFetch(top500Pages()));
  assert.equal(initial.deep_scan_requested, true);
  const pipeline = JSON.parse(r2.values.get(AMAZON_MUSIC_PIPELINE_STATE_KEY));
  assert.equal(pipeline.pending_trigger.reason, 'bootstrap');

  const unchanged = await checkAmazonUpdateAndQueue100k(env, 2000, amazonFetch(top500Pages()));
  assert.equal(unchanged.updated, false);
  assert.equal(unchanged.deep_scan_requested, false);
});

test('queued 100k scan publishes discovered Sakurazaka ranks to the Pages read model', async () => {
  const r2 = new FakeR2();
  const env = { PAGES_RESPONSE_R2: r2, MINUTE_DB: null };
  r2.values.set(AMAZON_MUSIC_PIPELINE_STATE_KEY, JSON.stringify({
    version: 1,
    active: false,
    active_trigger_id: null,
    pending_trigger: { id: 'update-1', observed_at: 3000, reason: 'top-500-update' },
  }));

  const result = await continueQueuedAmazon100kScan(env, 4000, amazonFetch([
    chartDocument([
      track('SAKURA1', 'Sakura Song', '櫻坂46'),
      track('OTHER1', 'Other Song', 'Other Artist'),
    ]),
  ]));

  assert.equal(result.skipped, false);
  assert.equal(result.complete, true);
  assert.equal(result.pages.sakurazaka_tracks_seen, 1);

  const publicKey = pagesR2ResponseKey('amazon-music');
  const envelope = JSON.parse(r2.values.get(publicKey));
  const payload = JSON.parse(envelope.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.source, 'amazon-music-jp-overall-100k');
  assert.equal(payload.follower, null);
  assert.equal(payload.scan.complete, true);
  assert.equal(payload.tracks.length, 1);
  assert.equal(payload.tracks[0].amazon_music_id, 'SAKURA1');
  assert.equal(payload.tracks[0].amazon_rank, 1);

  const pipeline = JSON.parse(r2.values.get(AMAZON_MUSIC_PIPELINE_STATE_KEY));
  assert.equal(pipeline.active, false);
  assert.equal(pipeline.pending_trigger, null);

  const idle = await continueQueuedAmazon100kScan(env, 5000, amazonFetch([]));
  assert.equal(idle.skipped, true);
});
