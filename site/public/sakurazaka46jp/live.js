const $ = (id) => document.getElementById(id);
const numberFormat = new Intl.NumberFormat('ja-JP');
const dateTimeFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

let refreshTimer = null;

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function valueText(value) {
  const parsed = finite(value);
  return parsed == null ? '—' : numberFormat.format(parsed);
}

function dateText(value) {
  const parsed = finite(value);
  return parsed == null || parsed <= 0 ? '—' : dateTimeFormat.format(new Date(parsed));
}

function ageText(ms) {
  const age = finite(ms);
  if (age == null) return '未取得';
  if (age < 60_000) return `${Math.max(0, Math.round(age / 1000))}秒前`;
  return `${Math.max(1, Math.round(age / 60_000))}分前`;
}

function renderChart(samples) {
  const values = (Array.isArray(samples) ? [...samples].reverse() : [])
    .map((sample) => finite(sample?.listener_count))
    .filter((value) => value != null);
  const line = $('chartLine');
  if (values.length < 2) {
    line.setAttribute('points', '');
    $('chartMin').textContent = values.length ? `最小 ${valueText(values[0])}` : '最小 —';
    $('chartMax').textContent = values.length ? `最大 ${valueText(values[0])}` : '最大 —';
    return;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 1000;
    const y = 240 - ((value - min) / range) * 220;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  line.setAttribute('points', points);
  $('chartMin').textContent = `最小 ${valueText(min)}`;
  $('chartMax').textContent = `最大 ${valueText(max)}`;
}

function render(payload) {
  const latest = payload?.latest || payload?.latest_main || null;
  const event = payload?.event || payload?.active_event || null;
  const active = payload?.collection_active === true;
  const badge = $('liveBadge');
  badge.textContent = active ? 'LIVE 収集中' : (event?.status === 'scheduled' ? '開始待ち' : '待機中');
  badge.classList.toggle('live', active);
  badge.classList.toggle('idle', !active);

  $('eventName').textContent = event?.event_name || '公式ニュースの告知待ち';
  if (active) {
    $('eventTime').textContent = `開始 ${dateText(event?.first_broadcast_at || event?.scheduled_at)}`;
  } else if (event?.status === 'scheduled') {
    $('eventTime').textContent = `予定 ${dateText(event?.scheduled_at)}`;
  } else {
    $('eventTime').textContent = '—';
  }

  $('listeners').textContent = valueText(latest?.listener_count);
  $('totalListens').textContent = valueText(latest?.total_listens);
  $('guests').textContent = valueText(latest?.guest_count);
  $('followers').textContent = valueText(latest?.followers);
  $('broadcastStart').textContent = dateText(latest?.broadcast_start_time);
  $('stationId').textContent = valueText(latest?.station_id);
  $('broadcastId').textContent = valueText(latest?.broadcast_id);

  const age = finite(payload?.latest_age_ms ?? payload?.latest_main_age_ms);
  $('updated').textContent = latest ? `最終取得 ${ageText(age)}` : '未取得';
  const freshness = $('freshness');
  if (!latest) {
    freshness.textContent = 'データ待ち';
    freshness.className = '';
  } else if (age != null && age <= 120_000) {
    freshness.textContent = '正常';
    freshness.className = 'fresh';
  } else {
    freshness.textContent = '更新待ち';
    freshness.className = 'stale';
  }

  renderChart(payload?.samples);
}

async function refresh() {
  clearTimeout(refreshTimer);
  const error = $('error');
  try {
    const response = await fetch('/api/sakurazaka46jp-status', {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
    render(payload);
    error.hidden = true;
    refreshTimer = setTimeout(refresh, Number(payload.refresh_hint_ms) || (payload.collection_active ? 15000 : 60000));
  } catch (reason) {
    error.textContent = `取得エラー: ${String(reason?.message || reason)}`;
    error.hidden = false;
    refreshTimer = setTimeout(refresh, 30000);
  }
}

refresh();
