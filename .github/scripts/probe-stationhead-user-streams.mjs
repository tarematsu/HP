import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const targetHandle = String(process.env.STATIONHEAD_TARGET_HANDLE || 'tokyosnow').trim().toLowerCase();
const configuredAccountId = Number(process.env.STATIONHEAD_TARGET_ACCOUNT_ID || 0);
const buddiesChannelId = Number(process.env.STATIONHEAD_BUDDIES_CHANNEL_ID || 318);
const output = process.env.PROBE_OUTPUT || 'stationhead-user-streams.json';
const profileUrl = `https://www.stationhead.com/${targetHandle}`;
const buddiesUrl = 'https://www.stationhead.com/c/buddies';

if (!targetHandle) throw new Error('STATIONHEAD_TARGET_HANDLE must not be empty');
if (!Number.isInteger(buddiesChannelId) || buddiesChannelId <= 0) {
  throw new Error('STATIONHEAD_BUDDIES_CHANNEL_ID must be a positive integer');
}

async function getJson(request, url) {
  const response = await request.get(url, {
    timeout: 30_000,
    failOnStatusCode: false,
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Keep the response body out of the artifact; only a short diagnostic is retained.
  }
  return {
    status: response.status(),
    body,
    textSample: body ? null : text.slice(0, 300),
  };
}

function findAccount(value, predicate, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 12) return null;
  if (!Array.isArray(value) && predicate(value)) return value;
  for (const child of Object.values(value)) {
    const match = findAccount(child, predicate, depth + 1);
    if (match) return match;
  }
  return null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

const report = {
  target_handle: targetHandle,
  buddies_channel_id: buddiesChannelId,
  observed_at: new Date().toISOString(),
  clicked: false,
  start_listening_clicked: false,
  account_id: null,
  total_streams: null,
  active_stream_days: null,
  endpoints: {},
  errors: [],
};

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });
  const page = await context.newPage();

  // Establish the same anonymous web session used by the public profile UI.
  await page.goto(profileUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });
  await page.waitForTimeout(2_000);

  let accountId = positiveInteger(configuredAccountId);
  if (!accountId) {
    const profileLookup = await getJson(
      context.request,
      `https://www.stationhead.com/api/account/handle/${encodeURIComponent(targetHandle)}`,
    );
    report.endpoints.profile_lookup_status = profileLookup.status;

    const profileAccount = profileLookup.body
      ? findAccount(
          profileLookup.body,
          (value) => String(value.handle || '').trim().toLowerCase() === targetHandle,
        )
      : null;
    accountId = positiveInteger(profileAccount?.id ?? profileAccount?.account_id);

    if (!accountId) {
      throw new Error(
        `failed to resolve account id for ${targetHandle} (status=${profileLookup.status}, body=${profileLookup.textSample || 'json'})`,
      );
    }
  } else {
    report.endpoints.profile_lookup_status = 'skipped';
  }
  report.account_id = accountId;

  // Load the Buddies landing page, but never click Start Listening or any other UI control.
  await page.goto(buddiesUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });
  await page.waitForTimeout(2_000);

  const metricsUrl = new URL('https://www.stationhead.com/api/account');
  metricsUrl.searchParams.set('channelId', String(buddiesChannelId));
  metricsUrl.searchParams.set('ids', String(accountId));

  const metricsResponse = await getJson(context.request, metricsUrl.href);
  report.endpoints.account_metrics_status = metricsResponse.status;
  if (metricsResponse.status !== 200 || !metricsResponse.body) {
    throw new Error(
      `account metrics request failed (status=${metricsResponse.status}, body=${metricsResponse.textSample || 'json'})`,
    );
  }

  const account = findAccount(
    metricsResponse.body,
    (value) => {
      const id = positiveInteger(value.id ?? value.account_id);
      const handle = String(value.handle || '').trim().toLowerCase();
      return id === accountId || handle === targetHandle;
    },
  );
  if (!account) throw new Error('target account missing from account metrics response');

  report.total_streams = nonNegativeInteger(account.total_streams);
  report.active_stream_days = nonNegativeInteger(account.active_stream_days);

  if (report.total_streams == null) {
    throw new Error('total_streams missing from account metrics response');
  }
  if (report.active_stream_days == null) {
    throw new Error('active_stream_days missing from account metrics response');
  }
} catch (error) {
  report.errors.push(error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify({
  target_handle: report.target_handle,
  buddies_channel_id: report.buddies_channel_id,
  account_id: report.account_id,
  total_streams: report.total_streams,
  active_stream_days: report.active_stream_days,
  clicked: report.clicked,
  start_listening_clicked: report.start_listening_clicked,
  errors: report.errors,
}));
