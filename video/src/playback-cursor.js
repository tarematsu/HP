const CURSOR_PATTERN = /^([01])\.([0-9]{1,10})\.([0-9]{1,20})$/;

export function parsePlaybackCursor(value) {
  const text = String(value || '');
  if (!text || text === 'start') return null;
  const match = CURSOR_PATTERN.exec(text);
  if (!match) return null;
  const phase = Number(match[1]);
  const shuffleKey = Number(match[2]);
  const videoId = Number(match[3]);
  if (!Number.isSafeInteger(shuffleKey) || !Number.isSafeInteger(videoId)) return null;
  return { phase, shuffleKey, videoId };
}

export function encodePlaybackCursor(phase, row) {
  return `${phase}.${Math.trunc(Number(row.shuffleKey) || 0)}.${Math.trunc(Number(row.id) || 0)}`;
}

export async function collectPlaybackCursorPage(limit, cursorValue, readPhase) {
  const pageLimit = Math.max(0, Number(limit) || 0);
  if (!pageLimit) return { rows: [], nextCursor: null };

  let cursor = parsePlaybackCursor(cursorValue);
  let phase = cursor?.phase ?? 0;
  const entries = [];
  let hasMore = false;

  while (entries.length <= pageLimit && phase <= 1) {
    const requested = pageLimit + 1 - entries.length;
    const batch = await readPhase(phase, cursor, requested);
    for (const row of batch || []) entries.push({ phase, row });

    if (entries.length > pageLimit) {
      hasMore = true;
      break;
    }
    if ((batch?.length || 0) >= requested) {
      hasMore = true;
      break;
    }
    if (phase === 0) {
      phase = 1;
      cursor = null;
      continue;
    }
    break;
  }

  const pageEntries = entries.slice(0, pageLimit);
  const last = pageEntries.at(-1);
  return {
    rows: pageEntries.map((entry) => entry.row),
    nextCursor: hasMore && last ? encodePlaybackCursor(last.phase, last.row) : null
  };
}
