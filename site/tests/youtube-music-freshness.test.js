import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/youtube-music.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*/gm, '').replace(/\bexport\s+/g, '');
function render(payload, now) {
  const texts = new Map();
  const notices = [];
  vm.runInNewContext(source + '\nrender(payload);', {
    payload,
    Date: class extends Date { static now() { return now; } },
    setText: (key, value) => texts.set(key, value),
    setNotice: (...args) => notices.push(args),
    musicDateTimeText: value => String(value || '-'),
    replaceMusicTableBody: () => null,
  });
  return { texts, notices };
}
test('freshly generated YouTube page cannot disguise stale successful source data', () => {
  const now = Date.now(), lastSuccess = now - 50 * 60 * 60_000;
  const result = render({ updated_at: now, services: [{ service: 'youtube_music', status: 'ok', last_success_at: lastSuccess }] }, now);
  assert.equal(result.texts.get('youtubeMusicUpdated'), String(lastSuccess));
  assert.match(result.notices[0][1], /取得が遅れ/);
});
test('confirmed fresh YouTube source shows its success time without a delay notice', () => {
  const now = Date.now(), lastSuccess = now - 1000;
  const result = render({ updated_at: now, services: [{ service: 'youtube_music', status: 'ok', last_success_at: lastSuccess }] }, now);
  assert.equal(result.texts.get('youtubeMusicUpdated'), String(lastSuccess));
  assert.equal(result.notices[0][1], undefined);
});
