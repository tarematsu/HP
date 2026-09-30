import assert from 'node:assert/strict';
import test from 'node:test';

import {
  durationLabel,
  officialPartyNumberText,
  OFFICIAL_PARTY_HEADERS,
  splitOfficialEventName,
} from '../public/official-listening-party-ui.js';

test('official listening party headers stay aligned across live and history views', () => {
  assert.deepEqual(OFFICIAL_PARTY_HEADERS, [
    '日付', '時間帯', '所要時間', '平均同接', '最小同接', '最大同接',
    '楽曲数', '推定再生数', '放送内容', 'イベント名', '出典',
  ]);
});

test('official listening party number formatting keeps missing values and formatter choice consistent', () => {
  const integer = new Intl.NumberFormat('ja-JP');
  const decimal = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 });
  assert.equal(officialPartyNumberText(null, integer), '—');
  assert.equal(officialPartyNumberText('', integer), '—');
  assert.equal(officialPartyNumberText('invalid', integer), '—');
  assert.equal(officialPartyNumberText(1234, integer), '1,234');
  assert.equal(officialPartyNumberText(12.34, decimal), '12.3');
});

test('duration labels preserve the shared minute and hour format', () => {
  assert.equal(durationLabel(null), '—');
  assert.equal(durationLabel(-1), '—');
  assert.equal(durationLabel(0), '0分');
  assert.equal(durationLabel(59.6), '1時間');
  assert.equal(durationLabel(61), '1時間1分');
  assert.equal(durationLabel(120), '2時間');
});

test('dated event names split consistently and preserve fallback date', () => {
  assert.deepEqual(splitOfficialEventName('2026/09/30 42nd アンダーライブ', {
    defaultName: '公式リスパ',
    fallbackDate: '2026/10/01',
  }), { date: '2026/09/30', name: '42nd アンダーライブ' });
  assert.deepEqual(splitOfficialEventName('イベント名のみ', {
    defaultName: '公式リスパ',
    fallbackDate: '2026/10/01',
  }), { date: '2026/10/01', name: 'イベント名のみ' });
});
