import { KUGOU_JAPAN_CHART_2024 } from './kugou-japan-chart-2024.js';
import { KUGOU_JAPAN_CHART_2025 } from './kugou-japan-chart-2025.js';
import { KUGOU_JAPAN_CHART_2026 } from './kugou-japan-chart-2026.js';

export const KUGOU_JAPAN_CHART_HISTORY = Object.freeze([
  ...KUGOU_JAPAN_CHART_2024,
  ...KUGOU_JAPAN_CHART_2025,
  ...KUGOU_JAPAN_CHART_2026,
]);

export const KUGOU_JAPAN_CHART_COVERAGE = Object.freeze({
  chart_id: 'japan_31312',
  oldest_available: '2024-10-31 10:10:01',
  latest_available: '2026-09-30 10:10:01',
  latest_checked: '2026-10-01 10:10:00',
  latest_rank_in: '2026-09-30 10:10:01',
  entries: KUGOU_JAPAN_CHART_HISTORY.length,
  note: 'Kugouの現行公開ランキングAPIで正しい過去Top 100を復元できた最古は2024-10-31。2024-10-31より前は現行APIが現在号へフォールバックするため未収録。',
});
