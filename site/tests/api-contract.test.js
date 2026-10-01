import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
  API_CONTRACT_VERSION,
  API_GROUPS,
  apiCacheTtlSeconds,
  canonicalApiPaths,
  edgeCacheableApiRequest,
  materializedApiKey,
  materializedResponseCadenceSeconds,
  materializedResponseMaximumAge,
} from '../functions/lib/api-contract.js';
import { apiCatalog } from '../functions/api/index.js';

function unique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} must not contain duplicates`);
}

test('API contract contains unique canonical paths only', () => {
  const canonical = canonicalApiPaths();
  unique(canonical, 'canonical API paths');
  assert.equal(canonical.length, 20);
  assert.ok(canonical.includes('/api/dashboard-details'));
  assert.ok(canonical.includes('/api/hinata'));
  assert.ok(canonical.includes('/api/history-current'));
  assert.ok(canonical.includes('/api/sakurazaka46jp-status'));
  assert.ok(canonical.includes('/api/nogizaka46smej-status'));
  assert.ok(canonical.includes('/api/nogizaka-listening-party'));
  assert.ok(canonical.includes('/api/first-week-comparison'));
  assert.ok(canonical.includes('/api/spotify-playcounts'));
  assert.ok(canonical.includes('/api/spotify-monthly-listeners'));
  assert.ok(canonical.includes('/api/spotify-playlists'));
  assert.ok(canonical.includes('/api/amazon-music'));
  assert.ok(canonical.includes('/api/apple-music'));
  assert.ok(canonical.includes('/api/apple-music-playlists'));
  assert.ok(canonical.includes('/api/regional-music'));
  assert.ok(canonical.includes('/api/followers'));
  assert.equal(existsSync(new URL('../functions/api/_middleware.js', import.meta.url)), false);
});

test('GET /api catalog is generated from the canonical contract only', () => {
  const catalog = apiCatalog(0);
  assert.equal(catalog.contract_version, API_CONTRACT_VERSION);
  assert.equal(catalog.contract_version, 16);
  assert.deepEqual(catalog.groups, API_GROUPS);
  assert.equal('compatibility' in catalog, false);
  assert.equal('retired' in catalog, false);
  assert.equal(catalog.worker_urls_public, false);
  assert.equal(catalog.public_write_api, false);
});

test('materialized response freshness follows event and revision policies', () => {
  for (const key of [
    'history:daily',
    'history:weekly',
    'history:broadcasts',
  ]) {
    assert.equal(materializedResponseCadenceSeconds(key), 1440 * 60, key);
    assert.equal(materializedResponseMaximumAge(key), Number.MAX_SAFE_INTEGER, key);
  }
  assert.equal(materializedResponseCadenceSeconds('spotify-playcounts'), 0);
  assert.equal(materializedResponseMaximumAge('spotify-playcounts'), Number.MAX_SAFE_INTEGER);
  assert.equal(materializedResponseCadenceSeconds('regional-music'), 0);
  assert.equal(materializedResponseMaximumAge('regional-music'), Number.MAX_SAFE_INTEGER);
  assert.equal(materializedResponseCadenceSeconds('followers'), 0);
  assert.equal(materializedResponseMaximumAge('followers'), Number.MAX_SAFE_INTEGER);
  assert.equal(materializedResponseCadenceSeconds('host-history:summary'), 1440 * 60);
  assert.equal(materializedResponseMaximumAge('host-history:summary'), Number.MAX_SAFE_INTEGER);
  assert.equal(materializedApiKey('https://skrzk.test/api/history?mode=monthly'), null);
  assert.equal(materializedApiKey('https://skrzk.test/api/followers'), 'followers');
  assert.equal(materializedApiKey('https://skrzk.test/api/regional-music'), 'regional-music');
  assert.equal(materializedApiKey('https://skrzk.test/api/regional-music?x=1'), null);
  assert.equal(materializedApiKey('https://skrzk.test/api/amazon-music'), null);
  assert.equal(materializedApiKey('https://skrzk.test/api/apple-music'), null);
  assert.equal(materializedApiKey('https://skrzk.test/api/apple-music-playlists'), null);
  assert.equal(materializedApiKey('https://skrzk.test/api/spotify-playlists'), null);
  assert.equal(materializedApiKey('https://skrzk.test/api/hinata'), null);
  assert.equal(materializedApiKey('https://skrzk.test/api/track-history'), null);
  assert.equal(materializedApiKey('https://skrzk.test/api/dashboard-details?channel_id=318'), null);
});

test('current minute history uses a 30-second shared cache', () => {
  assert.equal(apiCacheTtlSeconds(new Request('https://skrzk.test/api/history-current?mode=daily')), 30);
  assert.equal(apiCacheTtlSeconds(new Request('https://skrzk.test/api/history?mode=daily')), 300);
  assert.equal(apiCacheTtlSeconds(new Request('https://skrzk.test/api/dashboard-details?channel_id=318')), 300);
  assert.equal(apiCacheTtlSeconds(new Request('https://skrzk.test/api/hinata')), 300);
  assert.equal(apiCacheTtlSeconds(new Request('https://skrzk.test/api/first-week-comparison')), 3600);
  assert.equal(apiCacheTtlSeconds(new Request('https://skrzk.test/api/spotify-playcounts?artist=sakurazaka46')), 300);
  assert.equal(apiCacheTtlSeconds(new Request('https://skrzk.test/api/spotify-monthly-listeners?format=svg')), 300);
  assert.equal(apiCacheTtlSeconds(new Request('https://skrzk.test/api/spotify-playlists')), 300);
  assert.equal(apiCacheTtlSeconds(new Request('https://skrzk.test/api/amazon-music')), 300);
  assert.equal(apiCacheTtlSeconds(new Request('https://skrzk.test/api/apple-music')), 300);
  assert.equal(apiCacheTtlSeconds(new Request('https://skrzk.test/api/apple-music-playlists')), 300);
  assert.equal(apiCacheTtlSeconds(new Request('https://skrzk.test/api/regional-music')), 300);
  assert.equal(apiCacheTtlSeconds(new Request('https://skrzk.test/api/followers')), 300);
});

test('official Stationhead status and live listening-party endpoints bypass shared edge cache', () => {
  assert.equal(edgeCacheableApiRequest(new Request('https://skrzk.test/api/sakurazaka46jp-status')), false);
  assert.equal(edgeCacheableApiRequest(new Request('https://skrzk.test/api/nogizaka46smej-status')), false);
  assert.equal(edgeCacheableApiRequest(new Request('https://skrzk.test/api/nogizaka-listening-party')), false);
});

test('cache middleware contains the canonical Sakurazaka policies', () => {
  const source = readFileSync(new URL('../functions/lib/cache-middleware.js', import.meta.url), 'utf8');
  assert.match(source, /\/api\/sakurazaka46jp/);
  assert.match(source, /\/api\/first-week-comparison/);
  assert.match(source, /ttl: 3600/);
});
