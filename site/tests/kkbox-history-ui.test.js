import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../public/regional-music-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/kkbox-history-ui.js', import.meta.url), 'utf8');

test('KKBOX historical chart entries are exposed on Pages', () => {
  assert.match(shell, /KKBOX 日語チャート ランクイン履歴/);
  assert.match(shell, /kkboxJapaneseHistoryBody/);
  assert.match(shell, /headers: \['年月日', '地域', '周期', 'チャート', 'グループ', '順位', '曲名'\]/);
  assert.match(shell, /kkbox-history-ui\.js/);
  assert.match(runtime, /payload\?\.kkbox_japanese_chart\?\.history/);
  assert.match(runtime, /loadRegionalMusicReadModel\(SERVICE\)/);
  assert.match(runtime, /keyakizaka46: '欅坂46'/);
  assert.match(runtime, /hiragana_keyakizaka46: 'けやき坂46'/);
  assert.match(runtime, /location\.hash\.slice\(1\) === SERVICE/);
});
