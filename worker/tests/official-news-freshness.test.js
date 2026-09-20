import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { articleLinks, scheduleTimes } from '../src/official-news-html.js';

test('official news links keep current query parameters while extracting the news id', () => {
  const html = `<a href="/s/s46/news/detail/R00621?ima=0000&link=ROBO004">
    ROCK IN JAPAN FESTIVAL 2026 セットリストのStationheadリスニングパーティー開催決定！
  </a>`;

  assert.deepEqual(articleLinks(html, 20), [{
    newsId: 'R00621',
    href: 'https://sakurazaka46.com/s/s46/news/detail/R00621?ima=0000&link=ROBO004',
    listTitle: 'ROCK IN JAPAN FESTIVAL 2026 セットリストのStationheadリスニングパーティー開催決定！',
  }]);
});

test('the 2026-09-21 Stationhead announcement resolves to 11:45 JST', () => {
  assert.deepEqual(
    scheduleTimes('■リスニングパーティー開催スケジュール 2026年9月21日(月)11時45分頃から', 2026, '2026-09-20'),
    [Date.UTC(2026, 8, 21, 2, 45)],
  );
});

test('production scans multiple recent article bodies instead of only the newest one', () => {
  const wrangler = readFileSync(new URL('../wrangler.sakurazaka46jp.jsonc', import.meta.url), 'utf8');
  assert.match(wrangler, /"OFFICIAL_NEWS_BODY_SCAN_COUNT"\s*:\s*5/);
});
