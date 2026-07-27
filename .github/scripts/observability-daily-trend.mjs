const MIN_TREND_SECONDS = 10 * 60;
const MAX_TREND_SECONDS = 2 * 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;

function integer(value) {
  const normalized = String(value || '').replaceAll(',', '').trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function markdownCells(line) {
  const text = String(line || '').trim();
  if (!text.startsWith('|') || !text.endsWith('|')) return [];
  return text.slice(1, -1).split('|').map((cell) => cell.replaceAll('`', '').trim());
}

export function parseDailyRowsReadSnapshot(summary) {
  const text = String(summary || '');
  const date = text.match(/^- Date:\s*`(\d{4}-\d{2}-\d{2})`\s*$/m)?.[1] || '';
  const row = text
    .split(/\r?\n/)
    .map(markdownCells)
    .find((cells) => cells[0]?.toLowerCase() === 'd1 rows read');
  if (!row || row.length < 5) return null;

  const actual = integer(row[1]);
  const projected = integer(row[2]);
  const limit = integer(row[3]);
  const status = row.at(-1) || '';
  if (!date || actual == null || projected == null || limit == null || limit <= 0) return null;

  return {
    date,
    actual,
    projected,
    limit,
    status,
    violationSource: status.match(/VIOLATION\s*\(\s*(actual|projected)\s*\)/i)?.[1]?.toLowerCase() || '',
  };
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

export function classifyDailyRowsReadTrend({
  currentSummary = '',
  previousIssueBody = '',
  generatedAt = '',
} = {}) {
  const current = parseDailyRowsReadSnapshot(currentSummary);
  const previous = parseDailyRowsReadSnapshot(dailyDiagnostic(previousIssueBody));
  const currentTimestamp = Date.parse(String(generatedAt || ''));
  const previousTimestamp = issueGeneratedAt(previousIssueBody);

  if (!current || !previous || !Number.isFinite(currentTimestamp) || previousTimestamp == null) return null;
  if (current.date !== previous.date || current.violationSource !== 'actual') return null;

  const elapsedSeconds = Math.round((currentTimestamp - previousTimestamp) / 1000);
  if (elapsedSeconds < MIN_TREND_SECONDS || elapsedSeconds > MAX_TREND_SECONDS) return null;

  const delta = current.actual - previous.actual;
  if (delta < 0 || current.actual < current.limit) return null;

  const recentProjected24h = Math.ceil((delta * DAY_SECONDS) / elapsedSeconds);
  const contained = recentProjected24h < current.limit;
  return {
    contained,
    current,
    previous,
    elapsedSeconds,
    delta,
    recentProjected24h,
    evidence: contained
      ? `D1 rows read remain above the UTC-day limit, but increased by ${delta.toLocaleString('en-US')} over ${durationLabel(elapsedSeconds)} (recent pace ${recentProjected24h.toLocaleString('en-US')}/day vs ${current.limit.toLocaleString('en-US')}/day limit).`
      : `D1 rows read increased by ${delta.toLocaleString('en-US')} over ${durationLabel(elapsedSeconds)} (recent pace ${recentProjected24h.toLocaleString('en-US')}/day vs ${current.limit.toLocaleString('en-US')}/day limit).`,
  };
}
