import {
  finiteNumber as finite,
  integerFormat as numberFormat,
} from './dashboard-ui-common.js?v=20260930.1';

const dateTimeFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

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

function mountShell(root, handle) {
  root.innerHTML = `
    <header class="hero">
      <div>
        <p class="eyebrow">Stationhead official account</p>
        <h1 id="accountHandle"></h1>
      </div>
      <div id="liveBadge" class="badge idle">待機中</div>
    </header>
    <section class="event-card" aria-live="polite">
      <div class="label">収集対象</div>
      <div id="eventName" class="event-name">公式ニュースの告知待ち</div>
      <div id="eventTime" class="event-time">—</div>
    </section>
    <section class="metrics" aria-label="リアルタイム数値">
      <article class="metric"><div class="label">同接</div><div id="listeners" class="value">—</div></article>
      <article class="metric"><div class="label">累計リスナー</div><div id="totalListens" class="value">—</div></article>
      <article class="metric"><div class="label">ゲスト</div><div id="guests" class="value">—</div></article>
      <article class="metric"><div class="label">フォロワー</div><div id="followers" class="value">—</div></article>
    </section>
    <section class="panel">
      <div class="panel-head">
        <div><div class="label">同接推移</div><div class="sub">収集中は直近180サンプルを表示</div></div>
        <div id="updated" class="updated">未取得</div>
      </div>
      <svg id="chart" viewBox="0 0 1000 260" role="img" aria-label="同接推移グラフ" preserveAspectRatio="none">
        <polyline id="chartLine" points="" fill="none" vector-effect="non-scaling-stroke"></polyline>
      </svg>
      <div class="chart-meta"><span id="chartMin">最小 —</span><span id="chartMax">最大 —</span></div>
    </section>
    <section class="panel details">
      <div><span class="label">配信開始</span><span id="broadcastStart">—</span></div>
      <div><span class="label">Station ID</span><span id="stationId">—</span></div>
      <div><span class="label">Broadcast ID</span><span id="broadcastId">—</span></div>
      <div><span class="label">取得状態</span><span id="freshness">—</span></div>
    </section>
    <p id="error" class="error" hidden></p>`;
  root.querySelector('#accountHandle').textContent = handle;
}

export function startOfficialAccountLivePage(root = document.querySelector('[data-official-live-root]')) {
  if (!root) return null;
  const handle = String(root.dataset.handle || '').trim();
  const apiUrl = String(root.dataset.api || '').trim();
  if (!handle || !apiUrl) throw new Error('official live page requires data-handle and data-api');
  mountShell(root, handle);
  const $ = (id) => root.querySelector(`#${id}`);
  let refreshTimer = null;

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
    line.setAttribute('points', values.map((value, index) => {
      const x = (index / (values.length - 1)) * 1000;
      const y = 240 - ((value - min) / range) * 220;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' '));
    $('chartMin').textContent = `最小 ${valueText(min)}`;
    $('chartMax').textContent = `最大 ${valueText(max)}`;
  }

  function render(payload) {
    const latest = payload?.latest || null;
    const event = payload?.event || null;
    const active = payload?.collection_active === true;
    const badge = $('liveBadge');
    badge.textContent = active ? 'LIVE 収集中' : (event?.status === 'scheduled' ? '開始待ち' : '待機中');
    badge.classList.toggle('live', active);
    badge.classList.toggle('idle', !active);

    $('eventName').textContent = event?.event_name || '公式ニュースの告知待ち';
    if (active) $('eventTime').textContent = `開始 ${dateText(event?.first_broadcast_at || event?.scheduled_at)}`;
    else if (event?.status === 'scheduled') $('eventTime').textContent = `予定 ${dateText(event?.scheduled_at)}`;
    else $('eventTime').textContent = '—';

    $('listeners').textContent = valueText(latest?.listener_count);
    $('totalListens').textContent = valueText(latest?.total_listens);
    $('guests').textContent = valueText(latest?.guest_count);
    $('followers').textContent = valueText(latest?.followers);
    $('broadcastStart').textContent = dateText(latest?.broadcast_start_time);
    $('stationId').textContent = valueText(latest?.station_id);
    $('broadcastId').textContent = valueText(latest?.broadcast_id);

    const age = finite(payload?.latest_age_ms);
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

  function scheduleRefresh(delay) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
    if (!document.hidden) refreshTimer = setTimeout(refresh, delay);
  }

  async function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer = null;
    if (document.hidden) return;
    const error = $('error');
    try {
      const response = await fetch(apiUrl, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      render(payload);
      error.hidden = true;
      scheduleRefresh(Number(payload.refresh_hint_ms) || (payload.collection_active ? 15_000 : 60_000));
    } catch (reason) {
      error.textContent = `取得エラー: ${String(reason?.message || reason)}`;
      error.hidden = false;
      scheduleRefresh(30_000);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    } else refresh();
  });
  refresh();
  return { refresh };
}

if (typeof document !== 'undefined') startOfficialAccountLivePage();
