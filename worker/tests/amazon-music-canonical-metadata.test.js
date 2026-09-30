import assert from 'node:assert/strict';
import test from 'node:test';

import { loadAmazonMusicCanonicalMetadata } from '../src/amazon-music-collector.js';

class Statement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = String(sql);
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new Statement(this.db, this.sql, bindings);
  }

  async all() {
    this.db.calls.push({ sql: this.sql, bindings: this.bindings });
    const wanted = new Set(this.bindings.map(Number));
    return {
      results: this.db.rows.filter((row) => wanted.has(Number(row.track_id))),
    };
  }
}

class FakeDb {
  constructor(rows) {
    this.rows = rows;
    this.calls = [];
  }

  prepare(sql) {
    return new Statement(this, sql);
  }
}

test('Amazon Music canonical metadata is loaded once by sh_tracks.id and ignores duplicate aliases', async () => {
  const db = new FakeDb([
    { track_id: 101, title: '正規曲A', artist: '櫻坂46' },
    { track_id: 102, title: '正規曲B', artist: '櫻坂46' },
  ]);
  const ids = new Map([
    ['AMAZON-A', 101],
    ['AMAZON-A-ALT', 101],
    ['AMAZON-B', 102],
  ]);

  const metadata = await loadAmazonMusicCanonicalMetadata(db, ids);

  assert.deepEqual(metadata.get(101), { title: '正規曲A', artist: '櫻坂46' });
  assert.deepEqual(metadata.get(102), { title: '正規曲B', artist: '櫻坂46' });
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /FROM sh_track_canonical_metadata/);
  assert.deepEqual(db.calls[0].bindings, [101, 102]);
});
