const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600',
};

const FEATURED_HOSTS = ['sakuramankai', 'sakurazaka46jp'];
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

function expandWeeklyDates(values) {
  const sorted = [...new Set(values.filter(validDate))].sort();
  if (sorted.length < 2) return sorted;
  const first = Date.parse(`${sorted[0]}T00:00:00Z`);
  const last = Date.parse(`${sorted.at(-1)}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return sorted;
  const expanded = new Set(sorted);
  for (let ts = first; ts <= last; ts += 7 * 86400000) {
    expanded.add(new Date(ts).toISOString().slice(0, 10));
  }
  return [...expanded].sort();
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

function uniqueHosts(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const text = String(value || '').trim();
    const key = hostKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function firstSeenMap(rows) {
  return new Map((rows || []).map((row) => [hostKey(row.host_name), String(row.first_ranking_date || '')]));
}

function completeRankingTimeline(actualRows, rankingWeeks, hosts, firstSeen) {
  if (!hosts.length || !rankingWeeks.length) return [...actualRows];
  const byWeekHost = new Map();
  const firstActual = new Map();
  for (const row of actualRows) {
    const key = hostKey(row.host_name);
    byWeekHost.set(`${row.ranking_date}\u0000${key}`, row);
    const current = firstActual.get(key);
    if (!current || String(row.ranking_date) < current) firstActual.set(key, String(row.ranking_date));
  }
  const completed = [];
  for (const host of hosts) {
    const key = hostKey(host);
    const first = firstSeen.get(key) || firstActual.get(key) || '';
    if (!first) continue;
    for (const week of rankingWeeks) {
      if (week < first) continue;
      const existing = byWeekHost.get(`${week}\u0000${key}`);
      if (existing) {
        completed.push(existing);
        continue;
      }
      completed.push({
        ranking_date: week,
        observed_at: Date.parse(`${week}T00:00:00Z`),
        ranking_type: '週間リーダーボード',
        rank: null,
        host_name: host,
        host_alias: host,
        source_sheet: null,
        quality_score: null,
        quality_flags: 'not_listed',
        is_out_of_rank: true,
        synthetic: true,
      });
    }
  }
  return completed;
}

function matchingHosts(firstSeenRows, hostSearch) {
  const needle = hostKey(hostSearch);
  if (!needle) return [];
  return uniqueHosts((firstSeenRows || [])
    .filter((row) => hostKey(row.host_name).includes(needle) || hostKey(row.host_aliases).includes(needle))
    .map((row) => row.host_name));
}

export async function loadRanking(requestUrl, env, summaryLoader) {
  const from = requestUrl.searchParams.get('from') || '2024-06-01';
  const to = requestUrl.searchParams.get('to') || new Date().toISOString().slice(0, 10);
  const hostSearch = safeText(requestUrl.searchParams.get('host'));
  const scope = requestUrl.searchParams.get('scope') === 'all' ? 'all' : 'featured';
  const limit = Math.min(Math.max(Number(requestUrl.searchParams.get('limit')) || 5000, 20), 10000);

  let rankingSql = `SELECT
r.ranking_date,r.observed_at,r.ranking_type,r.rank,
r.channel_name AS host_name,r.channel_alias AS host_alias,
r.source_sheet,r.quality_score,r.quality_flags
FROM sh_channel_rankings r
WHERE r.ranking_date>=? AND r.ranking_date<=?`;
  const binds = [from, to];
  if (hostSearch) {
    rankingSql += ' AND (r.channel_name LIKE ? OR r.channel_alias LIKE ?)';
    binds.push(`%${hostSearch}%`, `%${hostSearch}%`);
  } else if (scope === 'featured') {
    rankingSql += ' AND lower(r.channel_name) IN (?,?)';
    binds.push(...FEATURED_HOSTS);
  }
  rankingSql += ' ORDER BY r.ranking_date ASC, r.rank ASC LIMIT ?';
  binds.push(limit);

  try {
    const [rankingResult, weeklyResult, weeksResult, firstSeenResult] = await Promise.all([
      env.OTHER_DB.prepare(rankingSql).bind(...binds).all(),
      summaryLoader(env, 'weekly', from, to),
      env.OTHER_DB.prepare(`SELECT DISTINCT ranking_date
FROM sh_channel_rankings
WHERE ranking_date>=? AND ranking_date<=?
ORDER BY ranking_date ASC`).bind(from, to).all(),
      env.OTHER_DB.prepare(`SELECT
MIN(channel_name) AS host_name,
GROUP_CONCAT(DISTINCT channel_alias) AS host_aliases,
MIN(ranking_date) AS first_ranking_date
FROM sh_channel_rankings
WHERE channel_name IS NOT NULL AND trim(channel_name)<>''
GROUP BY lower(trim(channel_name))
ORDER BY first_ranking_date ASC`).all(),
    ]);

    const actualRows = rankingResult.results || [];
    const weeklyMetrics = (weeklyResult.rows || []).map((row) => ({ ...row, ranking_date: row.period_key }));
    const rankingWeeks = expandWeeklyDates((weeksResult.results || []).map((row) => row.ranking_date));
    const firstSeenRows = firstSeenResult.results || [];
    const firstSeen = firstSeenMap(firstSeenRows);
    const actualHosts = uniqueHosts(actualRows.map((row) => row.host_name));
    const hosts = hostSearch
      ? matchingHosts(firstSeenRows, hostSearch)
      : scope === 'featured'
        ? FEATURED_HOSTS
        : actualHosts;

    const completedRows = completeRankingTimeline(actualRows, rankingWeeks, hosts, firstSeen);
    const aggregateAllHosts = scope === 'all' && !hostSearch;
    const rows = aggregateAllHosts ? [...actualRows] : completedRows;
    const hostOrder = scope === 'featured' && !hostSearch ? FEATURED_HOSTS : [];
    addRankChanges(rows);
    sortRankingRows(rows, hostOrder);

    const chartHosts = scope === 'featured' && !hostSearch
      ? FEATURED_HOSTS
      : hosts.length === 1 ? hosts : [];
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
      rows,
      weekly_metrics: weeklyMetrics,
      ranking_weeks: rankingWeeks,
      ranking_types: [...new Set(actualRows.map((row) => row.ranking_type).filter(Boolean))],
      host_count: hosts.length,
      ranking_summary: {
        week_count: rankingWeeks.length,
        host_count: hosts.length,
        ranked_entry_count: actualRows.filter((row) => validRank(row.rank)).length,
        out_of_rank_count: outOfRankCount,
      },
      truncated: actualRows.length >= limit,
      live_overlay_count: weeklyResult.live_overlay_count,
      latest_live_observed_at: weeklyResult.latest_live_observed_at,
    });
  } catch (error) {
    if (/no such table|no such column/i.test(String(error?.message || ''))) {
      return json({
        ok: true,
        mode: 'ranking',
        from,
        to,
        scope,
        host_search: hostSearch,
        featured_hosts: FEATURED_HOSTS,
        chart_hosts: [],
        rows: [],
        weekly_metrics: [],
        ranking_weeks: [],
        ranking_types: [],
        host_count: 0,
        ranking_summary: { week_count: 0, host_count: 0, ranked_entry_count: 0, out_of_rank_count: 0 },
        setup_required: true,
      });
    }
    throw error;
  }
}
