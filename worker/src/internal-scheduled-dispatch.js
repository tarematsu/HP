export const INTERNAL_SCHEDULED_PATH = '/__internal/scheduled';
const JSON_HEADERS = Object.freeze({ 'content-type': 'application/json' });

function normalizedScheduledTime(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : Date.now();
}

export async function dispatchScheduledService(service, cron, scheduledTime) {
  if (!service?.fetch) throw new Error('scheduled service binding is missing');
  const response = await service.fetch(`https://scheduler.internal${INTERNAL_SCHEDULED_PATH}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      cron,
      scheduled_time: normalizedScheduledTime(scheduledTime),
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`scheduled service failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  return response.json().catch(() => ({ ok: true }));
}

export async function handleInternalScheduled(
  request,
  env,
  runner,
  cron,
  allowedCrons = [cron],
) {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== INTERNAL_SCHEDULED_PATH) return null;

  const payload = await request.json().catch(() => ({}));
  const requestedCron = String(payload?.cron || cron);
  const accepted = new Set((Array.isArray(allowedCrons) ? allowedCrons : [cron]).map(String));
  if (!accepted.has(requestedCron)) {
    return Response.json({ ok: false, error: 'unsupported scheduled cron' }, {
      status: 400,
      headers: { 'cache-control': 'no-store' },
    });
  }
  const scheduledTime = normalizedScheduledTime(payload?.scheduled_time);
  const result = await runner({ cron: requestedCron, scheduledTime }, env, undefined);
  return Response.json({ ok: true, result: result ?? null }, {
    headers: { 'cache-control': 'no-store' },
  });
}
