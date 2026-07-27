const MIN_TREND_SECONDS = 10 * 60;
const MIN_PACE_ALERT_SECONDS = 20 * 60;
const MAX_TREND_SECONDS = 2 * 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;
const PACE_WARNING_RATIO = 0.8;
const SNAPSHOT_HISTORY_LIMIT = 8;

const SNAPSHOT_HISTORY_START = '<!-- d1-snapshot-history:start';
const SNAPSHOT_HISTORY_END = 'd1-snapshot-history:end -->';

const D1_SNAPSHOT_METRICS = Object.freeze([
  Object.freeze({ key: 'rowsRead', label: 'D1 rows read' }),
  Object.freeze({ key: 'rowsWritten', label: 'D1 rows written' }),
]);

function integer(value) {
  const normalized = String(value ?? '').replaceAll(',', '').trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function markdownCells(line) {
  const text = String(line || '').trim();
  if (!text.startsWith('|') || !text.endsWith('|')) return [];
  return text.slice(1, -1).split('|').map((cell) => cell.replaceAll('`', '').trim());
}

export function parseDailyMetricSnapshot(summary, metricLabel) {
  const text = String(summary || '');
  const date = text.match(/^- Date:\s*`(\d{4}-\d{2}-\d{2})`\s*$/m)?.[1] || '';
  const normalizedLabel = String(metricLabel || '').trim().toLowerCase();
  const row = text
    .split(/\r?\n/)
    .map(markdownCells)
    .find((cells) => cells[0]?.toLowerCase() === normalizedLabel);
  if (!row || row.length < 5) return null;

  const actual = integer(row[1]);
  const projected = integer(row[2]);
  const limit = integer(row[3]);
  const status = row.at(-1) || '';
  if (!date || actual == null || projected == null || limit == null || limit <= 0) return null;

  return {
    date,
    metric: row[0],
    actual,
    projected,
    limit,
    status,
    violationSource: status.match(/VIOLATION\s*\(\s*(actual|projected)\s*\)/i)?.[1]?.toLowerCase() || '',
  };
}

export function parseDailyRowsReadSnapshot(summary) {
  const snapshot = parseDailyMetricSnapshot(summary, 'D1 rows read');
  if (!snapshot) return null;
  const { metric: _metric, ...rowsRead } = snapshot;
  return rowsRead;
}

export function parseDailyRowsWrittenSnapshot(summary) {
  const snapshot = parseDailyMetricSnapshot(summary, 'D1 rows written');
  if (!snapshot) return null;
  const { metric: _metric, ...rowsWritten } = snapshot;
  return rowsWritten;
}

function issueGeneratedAt(issueBody) {
  const value = String(issueBody || '').match(/\*\*Generated:\*\*\s*([^·\n]+)/)?.[1]?.trim() || '';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function dailyDiagnostic(issueBody) {
  const body = String(issueBody || '');
  const start = body.indexOf('<a id="diagnostic-daily"');
  if (start < 0) return '';
  const next = body.indexOf('<a id="diagnostic-', start + 1);
  return body.slice(start, next < 0 ? body.length : next);
}

function durationLabel(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function paceAssessment(trend) {
  const ratio = trend.recentProjected24h / trend.current.limit;
  return {
    ratio,
    percent: ratio * 100,
    state: ratio >= 1 ? 'failure' : ratio >= PACE_WARNING_RATIO ? 'degraded' : 'healthy',
  };
}

function percentLabel(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function historyMetricKey(metricLabel) {
  const normalized = String(metricLabel || '').trim().toLowerCase();
  return D1_SNAPSHOT_METRICS.find((metric) => metric.label.toLowerCase() === normalized)?.key || '';
}

function snapshotHistoryEntry(summary, generatedAt) {
  const timestamp = Date.parse(String(generatedAt || ''));
  const rowsRead = parseDailyRowsReadSnapshot(summary);
  const rowsWritten = parseDailyRowsWrittenSnapshot(summary);
  const date = rowsRead?.date || rowsWritten?.date || '';
  if (!Number.isFinite(timestamp) || !date) return null;

  return {
    generatedAt: new Date(timestamp).toISOString(),
    date,
    rowsRead: rowsRead?.actual ?? null,
    rowsWritten: rowsWritten?.actual ?? null,
  };
}

function normalizeHistoryEntry(entry) {
  const timestamp = Date.parse(String(entry?.generatedAt || ''));
  const date = String(entry?.date || '').trim();
  const rowsRead = entry?.rowsRead == null ? null : integer(entry.rowsRead);
  const rowsWritten = entry?.rowsWritten == null ? null : integer(entry.rowsWritten);
  if (!Number.isFinite(timestamp) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (rowsRead == null && rowsWritten == null) return null;
  return {
    generatedAt: new Date(timestamp).toISOString(),
    date,
    rowsRead,
    rowsWritten,
  };
}

function deduplicateHistory(entries) {
  const byTimestamp = new Map();
  for (const candidate of entries || []) {
    const entry = normalizeHistoryEntry(candidate);
    if (!entry) continue;
    byTimestamp.set(`${entry.date}:${entry.generatedAt}`, entry);
  }
  return [...byTimestamp.values()]
    .sort((left, right) => Date.parse(left.generatedAt) - Date.parse(right.generatedAt))
    .slice(-SNAPSHOT_HISTORY_LIMIT);
}

export function parseD1SnapshotHistory(issueBody) {
  const body = String(issueBody || '');
  const start = body.indexOf(SNAPSHOT_HISTORY_START);
  const end = start < 0 ? -1 : body.indexOf(SNAPSHOT_HISTORY_END, start + SNAPSHOT_HISTORY_START.length);
  let persisted = [];

  if (start >= 0 && end >= 0) {
    const payloadStart = body.indexOf('\n', start);
    if (payloadStart >= 0 && payloadStart < end) {
      const payload = body.slice(payloadStart + 1, end).trim();
      try {
        const parsed = JSON.parse(payload);
        persisted = Array.isArray(parsed?.snapshots) ? parsed.snapshots : [];
      } catch {
        persisted = [];
      }
    }
  }

  const previousTimestamp = issueGeneratedAt(body);
  const fallback = previousTimestamp == null
    ? null
    : snapshotHistoryEntry(dailyDiagnostic(body), new Date(previousTimestamp).toISOString());
  return deduplicateHistory([...persisted, fallback].filter(Boolean));
}

export function renderD1SnapshotHistory({
  currentSummary = '',
  previousIssueBody = '',
  generatedAt = '',
} = {}) {
  const current = snapshotHistoryEntry(currentSummary, generatedAt);
  const snapshots = deduplicateHistory([
    ...parseD1SnapshotHistory(previousIssueBody),
    current,
  ].filter(Boolean));
  if (!snapshots.length) return '';
  return `${SNAPSHOT_HISTORY_START}
${JSON.stringify({ version: 1, snapshots })}
${SNAPSHOT_HISTORY_END}`;
}

function previousMetricSnapshots(previousIssueBody, metricLabel) {
  const key = historyMetricKey(metricLabel);
  if (!key) return [];
  return parseD1SnapshotHistory(previousIssueBody)
    .filter((entry) => entry[key] != null)
    .map((entry) => ({
      date: entry.date,
      actual: entry[key],
      generatedAt: entry.generatedAt,
    }));
}

export function calculateDailyMetricTrend({
  metricLabel,
  currentSummary = '',
  previousIssueBody = '',
  generatedAt = '',
  minimumElapsedSeconds = MIN_TREND_SECONDS,
} = {}) {
  const current = parseDailyMetricSnapshot(currentSummary, metricLabel);
  const currentTimestamp = Date.parse(String(generatedAt || ''));
  if (!current || !Number.isFinite(currentTimestamp)) return null;

  const minimum = Math.max(MIN_TREND_SECONDS, Number(minimumElapsedSeconds) || MIN_TREND_SECONDS);
  const candidates = previousMetricSnapshots(previousIssueBody, metricLabel)
    .map((previous) => {
      const previousTimestamp = Date.parse(previous.generatedAt);
      const elapsedSeconds = Math.round((currentTimestamp - previousTimestamp) / 1000);
      const delta = current.actual - previous.actual;
      return { previous, previousTimestamp, elapsedSeconds, delta };
    })
    .filter(({ previous, previousTimestamp, elapsedSeconds, delta }) => (
      Number.isFinite(previousTimestamp)
      && previous.date === current.date
      && elapsedSeconds >= minimum
      && elapsedSeconds <= MAX_TREND_SECONDS
      && delta >= 0
    ))
    .sort((left, right) => right.previousTimestamp - left.previousTimestamp);

  const selected = candidates[0];
  if (!selected) return null;

  return {
    current,
    previous: selected.previous,
    elapsedSeconds: selected.elapsedSeconds,
    delta: selected.delta,
    recentProjected24h: Math.ceil((selected.delta * DAY_SECONDS) / selected.elapsedSeconds),
  };
}

export function classifyDailyMetricPace({
  metricLabel,
  currentSummary = '',
  previousIssueBody = '',
  generatedAt = '',
} = {}) {
  const trend = calculateDailyMetricTrend({
    metricLabel,
    currentSummary,
    previousIssueBody,
    generatedAt,
    minimumElapsedSeconds: MIN_PACE_ALERT_SECONDS,
  });
  if (!trend) return null;

  const assessment = paceAssessment(trend);
  return {
    ...trend,
    ...assessment,
    evidence: `${metricLabel} increased by ${trend.delta.toLocaleString('en-US')} over ${durationLabel(trend.elapsedSeconds)} (recent pace ${trend.recentProjected24h.toLocaleString('en-US')}/day, ${percentLabel(assessment.percent)} of ${trend.current.limit.toLocaleString('en-US')}/day limit).`,
  };
}

export function classifyDailyD1SnapshotPaces({
  currentSummary = '',
  previousIssueBody = '',
  generatedAt = '',
} = {}) {
  return Object.fromEntries(D1_SNAPSHOT_METRICS.map((metric) => [
    metric.key,
    classifyDailyMetricPace({
      metricLabel: metric.label,
      currentSummary,
      previousIssueBody,
      generatedAt,
    }),
  ]));
}

export function classifyDailyRowsReadTrend({
  currentSummary = '',
  previousIssueBody = '',
  generatedAt = '',
} = {}) {
  const trend = calculateDailyMetricTrend({
    metricLabel: 'D1 rows read',
    currentSummary,
    previousIssueBody,
    generatedAt,
    minimumElapsedSeconds: MIN_PACE_ALERT_SECONDS,
  });
  if (!trend || trend.current.violationSource !== 'actual' || trend.current.actual < trend.current.limit) return null;

  const contained = trend.recentProjected24h < trend.current.limit;
  return {
    ...trend,
    contained,
    evidence: contained
      ? `D1 rows read remain above the UTC-day limit, but increased by ${trend.delta.toLocaleString('en-US')} over ${durationLabel(trend.elapsedSeconds)} (recent pace ${trend.recentProjected24h.toLocaleString('en-US')}/day vs ${trend.current.limit.toLocaleString('en-US')}/day limit).`
      : `D1 rows read increased by ${trend.delta.toLocaleString('en-US')} over ${durationLabel(trend.elapsedSeconds)} (recent pace ${trend.recentProjected24h.toLocaleString('en-US')}/day vs ${trend.current.limit.toLocaleString('en-US')}/day limit).`,
  };
}

export function renderDailyD1SnapshotPace({
  currentSummary = '',
  previousIssueBody = '',
  generatedAt = '',
} = {}) {
  const history = renderD1SnapshotHistory({
    currentSummary,
    previousIssueBody,
    generatedAt,
  });
  const trends = D1_SNAPSHOT_METRICS.map((metric) => ({
    metric,
    trend: calculateDailyMetricTrend({
      metricLabel: metric.label,
      currentSummary,
      previousIssueBody,
      generatedAt,
    }),
  })).filter(({ trend }) => trend);

  if (!trends.length) {
    return [history, '### D1 snapshot delta pace\n\n- Comparable snapshot unavailable. A prior snapshot from the same UTC date and a 10m–2h interval is required.']
      .filter(Boolean)
      .join('\n\n');
  }

  const rows = trends.map(({ metric, trend }) => {
    const assessment = paceAssessment(trend);
    const paceState = assessment.state === 'failure'
      ? 'above limit'
      : assessment.state === 'degraded'
        ? 'watch'
        : 'within limit';
    return `| ${metric.label} | +${trend.delta.toLocaleString('en-US')} | ${durationLabel(trend.elapsedSeconds)} | ${trend.recentProjected24h.toLocaleString('en-US')}/day | ${trend.current.limit.toLocaleString('en-US')}/day | ${percentLabel(assessment.percent)} | ${paceState} |`;
  }).join('\n');

  return `${history ? `${history}\n\n` : ''}### D1 snapshot delta pace

| Metric | Snapshot delta | Interval | Recent 24h pace | Daily limit | Pace usage | Pace status |
|---|---:|---:|---:|---:|---:|---|
${rows}

_Alert and containment classification use the newest comparable snapshot at least 20 minutes old._`;
}
