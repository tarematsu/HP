import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestGet } from '../functions/api/spotify-charts.js';
import { ROUTES, NAVIGATION } from '../public/dashboard-navigation-config.js';

test('chart API streams prebuilt index and year models without touching D1', async () => {
  for (const [query, key] of [['', 'spotify-charts'], ['?chart=regional-jp-daily&year=2026', 'spotify-charts:regional-jp-daily:2026']]) {
    const response = await onRequestGet({ request: new Request(`https://example.test/api/spotify-charts${query}`), env: {
      get OTHER_DB() { throw new Error('No D1 in Pages'); },
      PAGES_READ_MODEL_SERVICE: { async fetch(request) {
        assert.equal(new URL(request.url).searchParams.get('key'), key);
        return Response.json({ ok: true, sentinel: key });
      } },
    } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sentinel, key);
  }
  const response = await onRequestGet({ request: new Request('https://example.test/api/spotify-charts?chart=private&year=2026'), env: {} });
  assert.equal(response.status, 400);
});

test('playcounts and charts are independent lazy navigation destinations', () => {
  const sources = NAVIGATION.find(section => section.id === 'subscriptions').sources;
  assert.equal(sources.find(source => source.id === 'spotify').label, 'Spotify 再生数');
  assert.equal(sources.find(source => source.id === 'spotify-charts').label, 'Spotify チャート');
  assert.equal(ROUTES['spotify-charts'].viewId, 'spotifyChartsView');
  assert.notEqual(ROUTES.spotify.viewId, ROUTES['spotify-charts'].viewId);
});
