import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync(new URL('../public/regional-music.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/regional-music-shell.js', import.meta.url), 'utf8');

test('Melon renders only the QQ-style artist popularity table in compact mode', () => {
  assert.match(shell, /Melon アーティスト別人気曲順位/);
  assert.match(shell, /melonArtistPopularityBody/);
  assert.match(shell, /headers: \['グループ', '順位', '曲名'\]/);
  assert.match(shell, /artistFilterButtons\('melon', 'Melon 人気曲 表示グループ'\)/);
  assert.match(runtime, /service === 'melon' \|\| service === 'qq_music'/);
  assert.match(runtime, /melon: '毎週月曜日 00:00'/);
  assert.match(runtime, /item\?\.service === 'melon'/);
  assert.match(runtime, /item\?\.rank_source === 'provider_popularity_order'/);
  assert.match(runtime, /renderMelonPopularity\(payload, service\)/);
  assert.match(runtime, /data-melon-artist-filter/);
});
