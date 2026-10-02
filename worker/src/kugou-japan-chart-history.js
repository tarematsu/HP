import { KUGOU_JAPAN_CHART_LEGACY } from './kugou-japan-chart-legacy.js';
import { KUGOU_JAPAN_CHART_2024 } from './kugou-japan-chart-2024.js';
import { KUGOU_JAPAN_CHART_2025 } from './kugou-japan-chart-2025.js';
import { KUGOU_JAPAN_CHART_2026 } from './kugou-japan-chart-2026.js';

export const KUGOU_JAPAN_CHART_HISTORY = Object.freeze([
  ...KUGOU_JAPAN_CHART_LEGACY,
  ...KUGOU_JAPAN_CHART_2024,
  ...KUGOU_JAPAN_CHART_2025,
  ...KUGOU_JAPAN_CHART_2026,
]);

export const KUGOU_JAPAN_CHART_COVERAGE = Object.freeze({
  chart_id: 'japan_31312',
  oldest_available: '2021-01-01',
  oldest_rank_in: '2021-01-21',
  legacy_web_through: '2024-10-30',
  current_api_from: '2024-10-31',
  latest_available: '2026-09-30 10:10:01',
  latest_checked: '2026-10-01 10:10:00',
  latest_rank_in: '2026-09-30 10:10:01',
  entries: KUGOU_JAPAN_CHART_HISTORY.length,
  note: 'Kugou旧Webランキングの全ページから2021-01-01〜2024-10-30を復元し、2024-10-31以降は現行ランキングAPIを使用。',
});
