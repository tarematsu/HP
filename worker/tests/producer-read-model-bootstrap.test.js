import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapProducerReadModel } from '../scripts/bootstrap-producer-read-model.mjs';
import { REGIONAL_MUSIC_READ_MODEL_SERVICES } from '../src/regional-music-read-model.js';

for (const name of ['wrangler.regional-music.jsonc', 'wrangler.nogizaka46smej.jsonc']) {
  test(`${name} initializes an honest empty response without starting collection`, async () => {
    const writes = [];
    const db = { prepare() { return {
      bind() { return this; },
      async all() { return { results: [] }; },
      async first() { return null; },
    }; } };
    await bootstrapProducerReadModel(name, {
      db, now: Date.UTC(2026, 9, 1, 12),
      r2: { async put(key, body) { writes.push({ key, body }); } },
    });

    if (name.includes('regional')) {
      assert.equal(writes.length, REGIONAL_MUSIC_READ_MODEL_SERVICES.length);
      const payloads = writes.map(({ body }) => JSON.parse(JSON.parse(body).body));
      assert.deepEqual(
        payloads.map(({ service }) => service).sort(),
        [...REGIONAL_MUSIC_READ_MODEL_SERVICES].sort(),
      );
      for (const payload of payloads) {
        assert.equal(payload.ok, true);
        assert.equal(payload.read_model_version, 1);
        assert.deepEqual(payload.tracks, []);
        assert.deepEqual(payload.artists, []);
      }
    } else {
      assert.equal(writes.length, 1);
      const payload = JSON.parse(JSON.parse(writes[0].body).body);
      assert.equal(payload.ok, true);
      assert.equal(payload.event, null);
      assert.equal(payload.row, null);
      assert.equal(payload.collection_active, false);
    }
  });
}
