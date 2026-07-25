const DEFAULT_NETWORK_LIMIT = 500;
const DEFAULT_BODY_LIMIT = 65_536;
const DEFAULT_HTML_LIMIT = 262_144;
const TEXT_CONTENT_TYPE_RE = /(?:text\/|application\/(?:json|javascript|xhtml\+xml|xml|rss\+xml|atom\+xml|[^;]+\+json|[^;]+\+xml))/i;
const SECRET_HEADER_RE = /^(authorization|cookie|set-cookie|proxy-authorization|x-csrf-token|x-xsrf-token|csrf-token|xsrf-token|x-auth-token|x-api-key|cf-access-token)$/i;

function parseIntLimit(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function collectionCaptureEnabled(env = {}) {
  const value = String(env.COLLECTION_CAPTURE_ENABLED ?? 'true').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(value);
}

export function collectionCaptureLimits(env = {}) {
  return {
    networkLimit: parseIntLimit(env.COLLECTION_CAPTURE_NETWORK_LIMIT, DEFAULT_NETWORK_LIMIT, 0, 2000),
    bodyLimit: parseIntLimit(env.COLLECTION_CAPTURE_BODY_LIMIT, DEFAULT_BODY_LIMIT, 0, 262_144),
    htmlLimit: parseIntLimit(env.COLLECTION_CAPTURE_HTML_LIMIT, DEFAULT_HTML_LIMIT, 0, 1_048_576)
  };
}

export function isTextCaptureContentType(contentType) {
  return TEXT_CONTENT_TYPE_RE.test(String(contentType || ''));
}

export function sanitizeHeaders(headers = {}) {
  const output = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (SECRET_HEADER_RE.test(name)) continue;
    output[String(name).toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value ?? '');
  }
  return output;
}

function truncateText(value, limit) {
  const text = String(value || '');
  if (!Number.isFinite(limit) || limit <= 0) return { text: '', truncated: text.length > 0 };
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

export function ensureCollectionCaptureTables() {
  return undefined;
}

export async function persistCollectionCapture(env, run, metadata = {}, capture = null) {
  if (!capture || !collectionCaptureEnabled(env)) return null;
  const db = env?.DB;
  if (!db) return null;
  const limits = collectionCaptureLimits(env);

  const capturedAt = new Date().toISOString();
  const html = truncateText(capture.html || '', limits.htmlLimit);
  const events = (capture.networkEvents || []).slice(0, limits.networkLimit);
  const snapshotResult = await db.prepare(
    `INSERT INTO collection_capture_snapshots (
       run_id, source_method, source_key, source_url, final_url, captured_at,
       user_agent, viewport_json, timeout_ms, load_more_clicks,
       html_text, html_truncated, html_bytes, dom_signal_count, resource_url_count,
       network_event_count, note
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    run?.runId || null,
    metadata.method || capture.sourceMethod || 'unknown',
    metadata.sourceKey || capture.sourceKey || null,
    metadata.sourceUrl || capture.sourceUrl || null,
    capture.finalUrl || null,
    capturedAt,
    capture.userAgent || null,
    JSON.stringify(capture.viewport || null),
    capture.timeoutMs ?? null,
    Number(capture.loadMoreClicks || 0),
    html.text,
    html.truncated ? 1 : 0,
    Number(capture.htmlBytes || 0),
    Number(capture.domSignalCount || 0),
    Number(capture.resourceUrlCount || 0),
    events.length,
    metadata.note || null
  ).run();
  const snapshotId = Number(snapshotResult?.meta?.last_row_id || snapshotResult?.meta?.lastRowId || 0);
  if (!snapshotId) throw new Error('Failed to persist collection capture snapshot');
  if (!events.length) return { snapshotId, eventCount: 0 };

  const statements = events.map((event, index) => {
    const body = truncateText(event.bodyText || '', limits.bodyLimit);
    return db.prepare(
      `INSERT INTO collection_capture_network_events (
         snapshot_id, sequence, event_type, url, method, resource_type, status,
         content_type, request_headers_json, response_headers_json,
         body_text, body_truncated, body_bytes, occurred_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      snapshotId,
      index,
      event.eventType || 'response',
      event.url || '',
      event.method || null,
      event.resourceType || null,
      event.status ?? null,
      event.contentType || null,
      event.requestHeaders ? JSON.stringify(sanitizeHeaders(event.requestHeaders)) : null,
      event.responseHeaders ? JSON.stringify(sanitizeHeaders(event.responseHeaders)) : null,
      body.text,
      body.truncated || event.bodyTruncated ? 1 : 0,
      event.bodyBytes ?? null,
      event.occurredAt || capturedAt
    );
  });

  for (let offset = 0; offset < statements.length; offset += 50) {
    await db.batch(statements.slice(offset, offset + 50));
  }
  return { snapshotId, eventCount: events.length };
}

export async function readCollectionCaptureSummaries(db, limit = 20) {
  const safeLimit = parseIntLimit(limit, 20, 1, 100);
  const result = await db.prepare(
    `SELECT id, run_id AS runId, source_method AS sourceMethod, source_key AS sourceKey,
            source_url AS sourceUrl, final_url AS finalUrl, captured_at AS capturedAt,
            load_more_clicks AS loadMoreClicks, html_truncated AS htmlTruncated,
            html_bytes AS htmlBytes, dom_signal_count AS domSignalCount,
            resource_url_count AS resourceUrlCount, network_event_count AS networkEventCount,
            note
       FROM collection_capture_snapshots
      ORDER BY id DESC
      LIMIT ?`
  ).bind(safeLimit).all();
  return result.results || [];
}

export async function readCollectionCaptureDetails(db, id, eventLimit = 500) {
  const snapshotId = Number.parseInt(String(id || ''), 10);
  if (!Number.isFinite(snapshotId) || snapshotId <= 0) return null;
  const safeEventLimit = parseIntLimit(eventLimit, 500, 1, 2000);
  const snapshot = await db.prepare(
    `SELECT id, run_id AS runId, source_method AS sourceMethod, source_key AS sourceKey,
            source_url AS sourceUrl, final_url AS finalUrl, captured_at AS capturedAt,
            user_agent AS userAgent, viewport_json AS viewportJson, timeout_ms AS timeoutMs,
            load_more_clicks AS loadMoreClicks, html_text AS htmlText,
            html_truncated AS htmlTruncated, html_bytes AS htmlBytes,
            dom_signal_count AS domSignalCount, resource_url_count AS resourceUrlCount,
            network_event_count AS networkEventCount, note
       FROM collection_capture_snapshots
      WHERE id = ?`
  ).bind(snapshotId).first();
  if (!snapshot) return null;
  const events = await db.prepare(
    `SELECT sequence, event_type AS eventType, url, method, resource_type AS resourceType,
            status, content_type AS contentType, request_headers_json AS requestHeadersJson,
            response_headers_json AS responseHeadersJson, body_text AS bodyText,
            body_truncated AS bodyTruncated, body_bytes AS bodyBytes,
            occurred_at AS occurredAt
       FROM collection_capture_network_events
      WHERE snapshot_id = ?
      ORDER BY sequence ASC
      LIMIT ?`
  ).bind(snapshotId, safeEventLimit).all();
  return {
    ...snapshot,
    viewport: parseJson(snapshot.viewportJson),
    events: (events.results || []).map((event) => {
      const {
        requestHeadersJson,
        responseHeadersJson,
        ...rest
      } = event;
      return {
        ...rest,
        requestHeaders: parseJson(requestHeadersJson),
        responseHeaders: parseJson(responseHeadersJson)
      };
    })
  };
}
