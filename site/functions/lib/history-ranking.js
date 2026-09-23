import { loadWeeklyRankingReadModel } from './weekly-ranking-read-model.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600',
};

const FEATURED_HOSTS = ['sakuramankai', 'sakurazaka46jp'];
const READ_MODEL_SQL = `SELECT payload_json,source_max_ranking_date,refreshed_at
FROM sh_weekly_ranking_read_model
WHERE id=1`;
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });

function safeText(value, max = 100) {
  return String(value || '').trim().slice(0, max);
}

function hostKey(value) {
  return String(value || '').trim().toLowerCase();
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function validRank(value) {
  const number = finiteNumber(value);
  return number != null && number > 0;
}

function uniqueHosts(rows) {
  const result = [];
  const seen = new Set();
  for (const row of rows || []) {
    const text = String(row?.host_name || '').trim();
    const key = hostKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function sortRankingRows(rows, hostOrder = []) {
  const order = new Map(hostOrder.map((host, index) => [hostKey(host), index]));
  return rows.sort((a, b) => {
    const dateOrder = String(b.ranking_date).localeCompare(String(a.ranking_date));
    if (dateOrder !== 0) return dateOrder;
    const aOrder = order.get(hostKey(a.host_name));
    const bOrder = order.get(hostKey(b.host_name));
    if (aOrder != null || bOrder != null) return (aOrder ?? 9999) - (bOrder ?? 9999);
    const aRank = finiteNumber(a.rank);
    const bRank = finiteNumber(b.rank);
    if (aRank != null || bRank != null) return (aRank ?? 9999) - (bRank ?? 9999);
    return String(a.host_name || '').localeCompare(String(b.host_name || ''));
  });
}

function addRankChanges(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = hostKey(row.host_name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const hostRows of groups.values()) {
    hostRows.sort((a, b) => String(a.ranking_date).localeCompare(String(b.ranking_date)));
    let previous = null;
    for (const row of hostRows) {
      const currentRank = finiteNumber(row.rank);
      const previousRank = previous ? finiteNumber(previous.rank) : null;
      row.is_out_of_rank = currentRank == null;
      row.previous_rank = previousRank;
      row.previous_out_of_rank = Boolean(previous && previousRank == null);
      row.rank_change = previousRank != null && currentRank != null ? previousRank - currentRank : null;
      previous = row;
    }
  }
  return rows;
}

function summarizeHostRankings(actualRows) {
  const groups = new Map();
  for (const row of actualRows || []) {
    const rank = finiteNumber(row?.rank);
    const week = String(row?.ranking_date || '');
    const name = String(row?.host_name || '').trim();
    const key = hostKey(name);
    if (!key || !validDate(week) || rank == null || rank <= 0) continue;
    if (!groups.has(key)) {
      groups.set(key, {
        host_name: name,
        artist_name: String(row?.artist_name || '').trim() || null,
        fandom_type: row?.fandom_type === 'official' ? 'official' : row?.artist_name ? 'fandom' : null,
        fandom_label: String(row?.fandom_label || '').trim() || null,
        stationhead_channel_name: String(row?.stationhead_channel_name || '').trim() || null,
        by_week: new Map(),
      });
    }
    const group = groups.get(key);
    const previous = group.by_week.get(week);
    if (previous == null || rank < previous) group.by_week.set(week, rank);
  }

  const summaries = [...groups.values()].map((group) => {
    const ranks = [...group.by_week.values()];
    const summary = {
      host_name: group.host_name,
      ranked_weeks: ranks.length,
      average_rank: ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length,
      best_rank: Math.min(...ranks),
      worst_rank: Math.max(...ranks),
    };
    if (group.fandom_label) {
      summary.artist_name = group.artist_name;
      summary.fandom_type = group.fandom_type;
      summary.fandom_label = group.fandom_label;
      summary.stationhead_channel_name = group.stationhead_channel_name;
    }
    return summary;
  }).sort((a, b) => b.ranked_weeks - a.ranked_weeks
    || a.average_rank - b.average_rank
    || a.best_rank - b.best_rank
    || a.worst_rank - b.worst_rank
    || a.host_name.localeCompare(b.host_name));

  let previousWeeks = null;
  let previousPosition = 0;
  return summaries.map((summary, index) => {
    const position = previousWeeks === summary.ranked_weeks ? previousPosition : index + 1;
    previousWeeks = summary.ranked_weeks;
    previousPosition = position;
    return { position, ...summary };
  });
}

function inRange(row, from, to) {
  const week = String(row?.ranking_date || row?.period_key || '');
  return validDate(week) && week >= from && week <= to;
}

function matchingHostKeys(rows, search) {
  const needle = hostKey(search);
  if (!needle) return new Set();
  const keys = new Set();
  for (const row of rows || []) {
    const name = hostKey(row?.host_name);
    const alias = hostKey(row?.host_alias);
    if ((name && name.includes(needle)) || (alias && alias.includes(needle))) keys.add(name);
  }
  return keys;
}

function readModelUnavailable(from, to, scope, hostSearch) {
  return json({
    ok: true,
    mode: 'ranking',
    from,
    to,
    scope,
    host_search: hostSearch,
    featured_hosts: FEATURED_HOSTS,
    chart_hosts: [],
    host_rankings: [],
    rows: [],
    weekly_metrics: [],
    ranking_weeks: [],
    ranking_types: [],
    host_count: 0,
    ranking_summary: { week_count: 0, host_count: 0, ranked_entry_count: 0, out_of_rank_count: 0 },
    setup_required: true,
    read_path: 'weekly-ranking-read-model',
  });
}

export async function loadRanking(requestUrl, env, _summaryLoader) {
  const from = requestUrl.searchParams.get('from') || '2024-06-01';
  const to = requestUrl.searchParams.get('to') || new Date().toISOString().slice(0, 10);
  const hostSearch = safeText(requestUrl.searchParams.get('host'));
  const scope = requestUrl.searchParams.get('scope') === 'all' ? 'all' : 'featured';
  const limit = Math.min(Math.max(Number(requestUrl.searchParams.get('limit')) || 5000, 20), 10000);

  try {
    const stored = await env.OTHER_DB.prepare(READ_MODEL_SQL).first();
    if (!stored?.payload_json) return readModelUnavailable(from, to, scope, hostSearch);
    const model = await loadWeeklyRankingReadModel(env.OTHER_DB, stored);
    if (!model) return readModelUnavailable(from, to, scope, hostSearch);

    const sourceActual = (Array.isArray(model.actual_rows) ? model.actual_rows : []).filter((row) => inRange(row, from, to));
    const sourceCompleted = (Array.isArray(model.completed_rows) ? model.completed_rows : []).filter((row) => inRange(row, from, to));
    const featured = new Set(FEATURED_HOSTS.map(hostKey));
    let selectedKeys;
    if (hostSearch) {
      selectedKeys = matchingHostKeys(sourceCompleted.length ? sourceCompleted : sourceActual, hostSearch);
    } else if (scope === 'featured') {
      selectedKeys = featured;
    } else {
      selectedKeys = new Set(uniqueHosts(sourceActual)
        .map(hostKey)
        .filter((key) => !featured.has(key)));
    }

    const actualRowsAll = sourceActual.filter((row) => selectedKeys.has(hostKey(row.host_name)));
    const completedRows = sourceCompleted.filter((row) => selectedKeys.has(hostKey(row.host_name)));
    const truncated = actualRowsAll.length > limit;
    const actualRows = actualRowsAll.slice(0, limit).map((row) => ({ ...row }));
    const aggregateAllHosts = scope === 'all' && !hostSearch;
    const rows = aggregateAllHosts ? actualRows : completedRows.map((row) => ({ ...row }));
    addRankChanges(rows);
    sortRankingRows(rows, scope === 'featured' && !hostSearch ? FEATURED_HOSTS : []);

    const hostRankings = summarizeHostRankings(actualRowsAll);
    const chartHosts = scope === 'featured' && !hostSearch
      ? FEATURED_HOSTS
      : hostRankings[0]?.host_name ? [hostRankings[0].host_name] : [];
    const rankingWeeks = (Array.isArray(model.ranking_weeks) ? model.ranking_weeks : [])
      .filter((week) => validDate(week) && week >= from && week <= to);
    const weeklyMetrics = (Array.isArray(model.weekly_metrics) ? model.weekly_metrics : [])
      .filter((row) => inRange(row, from, to))
      .map((row) => ({ ...row, ranking_date: row.period_key }));
    const hostCount = hostSearch
      ? selectedKeys.size
      : scope === 'featured'
        ? FEATURED_HOSTS.length
        : uniqueHosts(actualRowsAll).length;
    const outOfRankCount = completedRows.filter((row) => !validRank(row.rank)).length;

    return json({
      ok: true,
      mode: 'ranking',
      from,
      to,
      scope,
      host_search: hostSearch,
      featured_hosts: FEATURED_HOSTS,
      chart_hosts: chartHosts,
      host_rankings: hostRankings,
      rows,
      weekly_metrics: weeklyMetrics,
      ranking_weeks: rankingWeeks,
      ranking_types: [...new Set(actualRowsAll.map((row) => row.ranking_type).filter(Boolean))],
      host_count: hostCount,
      ranking_summary: {
        week_count: rankingWeeks.length,
        host_count: hostRankings.length,
        ranked_entry_count: actualRowsAll.filter((row) => validRank(row.rank)).length,
        out_of_rank_count: outOfRankCount,
      },
      truncated,
      live_overlay_count: 0,
      latest_live_observed_at: null,
      materialized_at: Number(stored.refreshed_at) || Number(model.refreshed_at) || null,
      source_max_ranking_date: stored.source_max_ranking_date || model.source_max_ranking_date || null,
      read_path: 'weekly-ranking-read-model',
    });
  } catch (error) {
    if (/no such table|no such column/i.test(String(error?.message || ''))) {
      return readModelUnavailable(from, to, scope, hostSearch);
    }
    throw error;
  }
}
