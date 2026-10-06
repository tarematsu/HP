import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readModel = readFileSync(new URL('../src/nogizaka-read-model.js', import.meta.url), 'utf8');
const pagesModel = readFileSync(new URL('../src/nogizaka-pages-read-model.js', import.meta.url), 'utf8');
const pagesFetch = readFileSync(new URL('../src/pages-response-fetch-entry.js', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../src/nogizaka-entry.js', import.meta.url), 'utf8');
const finalized = readFileSync(new URL('../src/nogizaka-official-news.js', import.meta.url), 'utf8');
const config = JSON.parse(readFileSync(new URL('../wrangler.nogizaka46smej.jsonc', import.meta.url), 'utf8'));

test('Nogizaka active broadcasts materialize a minute read model before the Pages model is published', () => {
  assert.match(readModel, /WHERE a\.status='active'/);
  assert.match(readModel, /series\.refreshed_at<a\.updated_at/);
  assert.match(readModel, /summary\.refreshed_at<a\.updated_at/);
  assert.match(readModel, /ended_at=NULL/);
  assert.match(readModel, /ended_jst=NULL/);
  assert.match(readModel, /stationhead-live:nogizaka46smej/);
  assert.match(readModel, /GROUP BY elapsed_minute ORDER BY elapsed_minute ASC/);
  assert.match(readModel, /reconcileNogizakaOfficialAnnouncements\(env, runStartedAt, completedAt\)/);
  assert.match(readModel, /publishNogizakaListeningPartyReadModel\(env, completedAt\)/);
  assert.match(entry, /reconcile: reconcileNogizakaReadModels/);
});

test('Nogizaka reconciliation preserves the existing finalized model pass after live materialization', () => {
  assert.match(readModel, /materializeActiveReadModels\(env, completedAt\)/);
  assert.match(readModel, /reconcileNogizakaOfficialAnnouncements\(env, runStartedAt, completedAt\)/);
  assert.match(finalized, /WHERE a\.status='ended'/);
  assert.match(finalized, /stationhead-finalized:nogizaka46smej/);
  assert.match(finalized, /summary\.ended_at IS NULL/);
});

test('Nogizaka publishes a producer-owned Pages read model to the shared R2 bucket', () => {
  assert.match(pagesModel, /NOGIZAKA_LISTENING_PARTY_MODEL_KEY = 'nogizaka-listening-party'/);
  assert.match(pagesModel, /pagesR2ResponseKey\(NOGIZAKA_LISTENING_PARTY_MODEL_KEY\)/);
  assert.match(pagesModel, /PAGES_RESPONSE_R2 binding is missing/);
  assert.match(pagesFetch, /'nogizaka-listening-party'/);
  const servingConfig = JSON.parse(readFileSync(new URL('../wrangler.runtime.jsonc', import.meta.url), 'utf8'));
  assert.deepEqual(config.r2_buckets, servingConfig.r2_buckets);
});

test('Nogizaka Pages read model excludes announcements already marked invalid', () => {
  assert.match(pagesModel, /WHERE status<>'invalid' AND \(/);
});
