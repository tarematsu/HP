import { KUGOU_JAPAN_CHART_LEGACY_PRE2021 } from './kugou-japan-chart-legacy-pre2021.js';
import { KUGOU_JAPAN_CHART_LEGACY_2021 } from './kugou-japan-chart-legacy-2021.js';
import { KUGOU_JAPAN_CHART_LEGACY_2022 } from './kugou-japan-chart-legacy-2022.js';
import { KUGOU_JAPAN_CHART_LEGACY_2023 } from './kugou-japan-chart-legacy-2023.js';
import { KUGOU_JAPAN_CHART_LEGACY_2024 } from './kugou-japan-chart-legacy-2024.js';
import { KUGOU_JAPAN_CHART_LEGACY_COVERED_DATES } from './kugou-japan-chart-legacy-covered-dates.js';
import { KUGOU_JAPAN_CHART_2024 } from './kugou-japan-chart-2024.js';
import { KUGOU_JAPAN_CHART_2025 } from './kugou-japan-chart-2025.js';
import { KUGOU_JAPAN_CHART_2026 } from './kugou-japan-chart-2026.js';

export const KUGOU_JAPAN_CHART_HISTORY = Object.freeze([
  ...KUGOU_JAPAN_CHART_LEGACY_PRE2021,
  ...KUGOU_JAPAN_CHART_LEGACY_2021,
  ...KUGOU_JAPAN_CHART_LEGACY_2022,
  ...KUGOU_JAPAN_CHART_LEGACY_2023,
  ...KUGOU_JAPAN_CHART_LEGACY_2024,
  ...KUGOU_JAPAN_CHART_2024,
  ...KUGOU_JAPAN_CHART_2025,
  ...KUGOU_JAPAN_CHART_2026,
]);

export const KUGOU_JAPAN_CHART_COVERAGE = Object.freeze({
  chart_id: 'japan_31312',
  oldest_available: '2017-11-22',
  legacy_latest_available: '2024-10-30',
  current_api_oldest_available: '2024-10-31 10:10:01',
  latest_available: '2026-09-30 10:10:01',
  latest_checked: '2026-10-01 10:10:00',
  latest_rank_in: '2026-09-30 10:10:01',
  legacy_covered_dates: KUGOU_JAPAN_CHART_LEGACY_COVERED_DATES,
  entries: KUGOU_JAPAN_CHART_HISTORY.length,
  note: '2017-11-22〜2024-10-30はKugou旧Web日本榜の保存ページから各公開号を復元。初期の一部号は当時の公開件数自体が100曲未満。2024-10-31以降は現行ランキングAPIを使用。',
});
