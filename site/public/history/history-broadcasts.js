(() => {
  const button = document.querySelector('[data-mode="broadcasts"]');
  const canvas = document.getElementById('chart');
  const legend = document.getElementById('chartLegend');
  const notice = document.getElementById('notice');
  const fromInput = document.getElementById('from');
  const toInput = document.getElementById('to');
  if (!button || !canvas || !legend || !notice || !fromInput || !toInput) return;

  const CACHE_MS = 15 * 60_000;
  const MAX_CACHE_POINTS = 30_000;
  const MAX_DRAW_POINTS = 2_400;
  const CACHE_REVISION = '9';
  const API_REVISION = '3';
  const SESSION_MATCH_TOLERANCE_MS = 15 * 60_000;
  const number = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 });
  const integer = new Intl.NumberFormat('ja-JP');
  const eventDate = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'UTC', month: 'numeric', day: 'numeric',
  });
  const jstDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const DATE_PREFIX = /^\s*\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/;
  const SERIES_COLORS = [
    ['--accent', '#d93f79'],
    ['--accent-2', '#6657d8'],
    ['--green', '#168b73'],
    ['--orange', '#c56a18'],
    ['--blue', '#2776b9'],
    ['--danger', '#c53d4d'],
    [null, '#00838f'],
    [null, '#8c6d1f'],
    [null, '#6b55a3'],
    [null, '#b23a98'],
    [null, '#4f772d'],
    [null, '#006d9c'],
  ];
  const TABLE_METRICS = ['平均同接', '最小同接', '最大同接', '曲数', '推定再生数', 'コメント数'];
  let series = [];
  let hostSessions = [];
  let hostSessionsPromise = null;
  let selectedMinute = null;
  let loadingKey = '';
  let loadedKey = '';
  let loadedMeta = null;
  let controller = null;
  let loadTimer = null;
  let resizeTimer = null;
  let tableTimer = null;
  let tableEnhancing = false;

  button.textContent = '公式リスパ';

  const active = () => button.classList.contains('active');
  const finite = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const escape = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  function elapsedLabel(minutes) {
    const value = Math.max(0, Math.round(Number(minutes) || 0));
    if (value < 60) return `${value}分`;
    const hours = Math.floor(value / 60);
    const rest = value % 60;
    return rest ? `${hours}時間${rest}分` : `${hours}時間`;
  }

  function eventLabel(item) {
    const name = String(item?.event_name || '公式リスパ').trim();
    if (DATE_PREFIX.test(name)) return name;
    const startedAt = Number(item?.started_at);
    return Number.isFinite(startedAt)
      ? `${eventDate.format(new Date(startedAt))} ${name}`
      : name;
  }

  function isTodayEvent(item) {
    const startedAt = Number(item?.started_at);
    return Number.isFinite(startedAt)
      && jstDay.format(new Date(startedAt)) === jstDay.format(new Date());
  }

  function missingSuffix(item) {
    if (item?.points?.length) return '';
    return item?.source_mismatch ? '（集計値のみ）' : '（データ未取得）';
  }

  function cssColor(name, fallback) {
    if (!name) return fallback;
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function colorFor(index) {
    const preset = SERIES_COLORS[index];
    if (preset) return cssColor(preset[0], preset[1]);
    const hue = (18 + index * 137.508) % 360;
    return `hsl(${hue.toFixed(1)} 62% 44%)`;
  }

  function samplePoints(points, maximum = MAX_DRAW_POINTS) {
    if (!Array.isArray(points) || points.length <= maximum) return points || [];
    const result = [points[0]];
    const step = Math.max(1, Math.ceil((points.length - 2) / (maximum - 2)));
    for (let index = 1; index < points.length - 1; index += step) result.push(points[index]);
    result.push(points.at(-1));
    return result;
  }

  function prepareSeries(items) {
    return (Array.isArray(items) ? items : []).map((item) => {
      const points = Array.isArray(item.points) ? item.points : [];
      let maxMinute = 0;
      let maxListener = 0;
      let minListener = Infinity;
      let listenerSum = 0;
      let listenerCount = 0;
      for (const point of points) {
        const minute = Number(point?.[0]);
        const listener = Number(point?.[1]);
        if (Number.isFinite(minute)) maxMinute = Math.max(maxMinute, minute);
        if (Number.isFinite(listener)) {
          maxListener = Math.max(maxListener, listener);
          minListener = Math.min(minListener, listener);
          listenerSum += listener;
          listenerCount += 1;
        }
      }
      return {
        ...item,
        points,
        drawPoints: samplePoints(points),
        maxMinute,
        maxListener,
        minListener: Number.isFinite(minListener) ? minListener : null,
        averageListener: listenerCount ? listenerSum / listenerCount : null,
      };
    });
  }

  function nearestPoint(points, targetMinute) {
    if (!points?.length) return null;
    let low = 0;
    let high = points.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (Number(points[middle][0]) < targetMinute) low = middle + 1;
      else high = middle;
    }
    const current = points[low];
    const previous = low > 0 ? points[low - 1] : null;
    if (!previous) return current;
    return Math.abs(Number(previous[0]) - targetMinute) <= Math.abs(Number(current[0]) - targetMinute)
      ? previous
      : current;
  }

  function renderDetail(minute) {
    const detail = document.getElementById('chartDetail');
    if (!detail) return;
    if (minute == null) {
      detail.innerHTML = '<span>グラフをタッチまたはクリックすると、開始後の同じ時点で全リスパを比較できます。</span>';
      return;
    }
    const values = series.map((item, index) => ({
      item,
      index,
      point: nearestPoint(item.points, minute),
    })).filter(({ point }) => point && Math.abs(Number(point[0]) - minute) <= 5);
    detail.innerHTML = `<time>開始から ${elapsedLabel(minute)}</time><div class="chart-detail-values broadcast-detail-values">${values.map(({ item, index, point }) =>
      `<div><i style="background:${colorFor(index)}"></i><strong>${escape(eventLabel(item))}</strong><span>${number.format(Number(point[1]) || 0)}人</span></div>`).join('')}</div>`;
  }

  function draw() {
    if (!active()) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = canvas.clientWidth || 1_000;
    const height = canvas.clientHeight || 330;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const tableTitle = document.getElementById('tableTitle');
    if (tableTitle) tableTitle.textContent = '公式リスパ一覧';
    const available = series.filter((item) => item.points.length);
    document.getElementById('chartTitle').textContent = '公式リスパ 同接推移（開始0分比較）';
    document.getElementById('chartFoot').textContent = '各線は1回の公式リスパです。横軸は各開催の開始からの経過時間です。';
    if (!available.length) {
      context.font = '14px system-ui';
      context.fillStyle = cssColor('--muted', '#667287');
      context.textAlign = 'center';
      context.fillText('表示できる公式リスパデータがありません', width / 2, height / 2);
      legend.innerHTML = series.map((item, index) =>
        `<span><i style="background:${colorFor(index)}"></i>${escape(eventLabel(item))}${missingSuffix(item)}</span>`).join('');
      renderDetail(null);
      scheduleTableEnhance();
      return;
    }

    const maxMinute = Math.max(1, ...available.map((item) => item.maxMinute));
    const maxListener = Math.max(50, Math.ceil(Math.max(...available.map((item) => item.maxListener)) / 50) * 50);
    const area = { left: 58, right: 18, top: 18, bottom: 42 };
    area.width = Math.max(1, width - area.left - area.right);
    area.height = Math.max(1, height - area.top - area.bottom);
    const xFor = (minute) => area.left + area.width * Math.max(0, Number(minute) || 0) / maxMinute;
    const yFor = (value) => area.top + area.height - area.height * Math.max(0, Number(value) || 0) / maxListener;

    context.lineWidth = 1;
    context.strokeStyle = 'rgba(31,45,68,.12)';
    context.fillStyle = cssColor('--muted', '#667287');
    context.font = '10.5px system-ui';
    for (let index = 0; index <= 4; index += 1) {
      const y = area.top + area.height * index / 4;
      context.beginPath();
      context.moveTo(area.left, y);
      context.lineTo(width - area.right, y);
      context.stroke();
      context.textAlign = 'right';
      context.fillText(number.format(Math.round(maxListener * (1 - index / 4))), area.left - 8, y + 3);
    }

    const xTickCount = width < 560 ? 4 : 6;
    for (let index = 0; index <= xTickCount; index += 1) {
      const minute = Math.round(maxMinute * index / xTickCount);
      const x = xFor(minute);
      context.textAlign = index === 0 ? 'left' : index === xTickCount ? 'right' : 'center';
      context.fillText(number.format(minute), x, area.top + area.height + 16);
    }
    context.textAlign = 'center';
    context.fillText('経過時間（分）', area.left + area.width / 2, height - 5);

    available.forEach((item) => {
      const index = series.indexOf(item);
      const today = isTodayEvent(item);
      context.save();
      context.strokeStyle = colorFor(index);
      context.globalAlpha = today ? 1 : (available.length > 12 ? 0.68 : 0.9);
      context.lineWidth = today ? 3.4 : (available.length > 16 ? 1.15 : 1.7);
      context.beginPath();
      let open = false;
      for (const point of item.drawPoints) {
        const minute = Number(point?.[0]);
        const listener = Number(point?.[1]);
        if (!Number.isFinite(minute) || !Number.isFinite(listener)) continue;
        if (!open) context.moveTo(xFor(minute), yFor(listener));
        else context.lineTo(xFor(minute), yFor(listener));
        open = true;
      }
      context.stroke();
      context.restore();
    });

    if (selectedMinute != null) {
      const x = xFor(selectedMinute);
      context.save();
      context.strokeStyle = cssColor('--muted', '#667287');
      context.globalAlpha = 0.55;
      context.setLineDash([4, 4]);
      context.beginPath();
      context.moveTo(x, area.top);
      context.lineTo(x, area.top + area.height);
      context.stroke();
      context.restore();
    }

    legend.innerHTML = series.map((item, index) =>
      `<span><i style="background:${colorFor(index)}"></i>${escape(eventLabel(item))}${missingSuffix(item)}</span>`).join('');
    document.getElementById('chartStartDate').textContent = '開始 0分';
    document.getElementById('chartEndDate').textContent = `最長 ${elapsedLabel(maxMinute)}`;
    renderDetail(selectedMinute);
    canvas.dataset.sakurazakaMaxMinute = String(maxMinute);
    canvas.dataset.sakurazakaLeft = String(area.left);
    canvas.dataset.sakurazakaWidth = String(area.width);
    scheduleTableEnhance();
  }

  function cacheKey() {
    return `sakurazaka46jp:v1:r${CACHE_REVISION}:${fromInput.value}:${toInput.value}`;
  }

  function readCache() {
    try {
      const stored = JSON.parse(sessionStorage.getItem(cacheKey()));
      return stored && Date.now() - stored.at < CACHE_MS ? stored.data : null;
    } catch {
      return null;
    }
  }

  function writeCache(data) {
    if (Number(data?.point_count || 0) > MAX_CACHE_POINTS) return;
    try { sessionStorage.setItem(cacheKey(), JSON.stringify({ at: Date.now(), data })); } catch {}
  }

  function updateNotice(data) {
    if (!data || !active()) return;
    notice.textContent = '';
    notice.hidden = true;
  }

  function normalizedEventName(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/（(?:集計値のみ|データ未取得)）/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function parseTableNumber(value) {
    const text = String(value ?? '').replaceAll(',', '').trim();
    if (!text || text === '—') return null;
    const match = text.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/);
    return match ? finite(match[0]) : null;
  }

  function parseUtcTableDate(value) {
    const match = String(value || '').match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2}).*?(\d{1,2}):(\d{2})/);
    if (!match) return null;
    return Date.UTC(
      Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]),
    );
  }

  function findSeriesForRow(eventName, startedAt) {
    const key = normalizedEventName(eventName);
    const exact = key ? series.find((item) => normalizedEventName(item.event_name) === key) : null;
    if (exact) return exact;
    if (Number.isFinite(startedAt)) {
      const close = series
        .map((item) => ({ item, diff: Math.abs((finite(item.started_at) ?? Infinity) - startedAt) }))
        .filter(({ diff }) => diff <= SESSION_MATCH_TOLERANCE_MS)
        .sort((left, right) => left.diff - right.diff)[0];
      if (close) return close.item;
    }
    if (!key) return null;
    return series.find((item) => {
      const candidate = normalizedEventName(item.event_name);
      return candidate.length >= 8 && (candidate.includes(key) || key.includes(candidate));
    }) || null;
  }

  function findSession(startedAt) {
    if (!Number.isFinite(startedAt)) return null;
    const nearest = hostSessions
      .map((item) => ({ item, diff: Math.abs((finite(item?.started_at) ?? Infinity) - startedAt) }))
      .filter(({ diff }) => diff <= SESSION_MATCH_TOLERANCE_MS)
      .sort((left, right) => left.diff - right.diff)[0];
    return nearest?.item || null;
  }

  function writeCell(cell, value, formatter = number) {
    if (!cell) return;
    const text = value == null ? '—' : formatter.format(value);
    if (cell.textContent !== text) cell.textContent = text;
  }

  function ensureTableMetricColumns(head, body) {
    const row = head.querySelector('tr');
    if (!row) return null;
    const labels = [...row.querySelectorAll('th')].map((cell) => cell.textContent.trim());
    for (const label of TABLE_METRICS) {
      if (labels.includes(label)) continue;
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = label;
      if (label === '推定再生数') cell.title = '曲数 × 平均同接';
      row.appendChild(cell);
      labels.push(label);
    }
    for (const bodyRow of body.querySelectorAll('tr')) {
      const cells = bodyRow.querySelectorAll('td');
      if (cells.length === 1 && Number(cells[0].colSpan) > 1) {
        cells[0].colSpan = labels.length;
      }
    }
    return new Map(labels.map((label, index) => [label, index]));
  }

  function enhanceBroadcastTable() {
    if (!active() || tableEnhancing) return;
    const head = document.getElementById('thead');
    const body = document.getElementById('tbody');
    if (!head || !body) return;
    tableEnhancing = true;
    try {
      const indexes = ensureTableMetricColumns(head, body);
      if (!indexes) return;
      const headers = [...head.querySelectorAll('th')];
      const eventIndex = headers.findIndex((cell) => cell.textContent.trim() === '放送名');
      const startIndex = headers.findIndex((cell) => cell.textContent.trim().startsWith('開始日時'));
      if (eventIndex < 0) return;

      for (const row of body.querySelectorAll('tr')) {
        let cells = [...row.querySelectorAll('td')];
        if (cells.length === 1 && Number(cells[0].colSpan) > 1) continue;
        while (cells.length < headers.length) {
          const cell = document.createElement('td');
          row.appendChild(cell);
          cells.push(cell);
        }
        const startedFromTable = startIndex >= 0 ? parseUtcTableDate(cells[startIndex]?.textContent) : null;
        const item = findSeriesForRow(cells[eventIndex]?.textContent, startedFromTable);
        const startedAt = finite(item?.started_at) ?? startedFromTable;
        const session = findSession(startedAt);
        const readMetric = (label) => parseTableNumber(cells[indexes.get(label)]?.textContent);

        const average = readMetric('平均同接')
          ?? finite(session?.average_listeners)
          ?? finite(item?.averageListener);
        const minimum = readMetric('最小同接') ?? finite(item?.minListener);
        const maximum = readMetric('最大同接')
          ?? finite(session?.peak_listeners)
          ?? finite(item?.maxListener);
        const tracks = readMetric('曲数') ?? finite(session?.track_count);
        const estimated = average != null && tracks != null ? Math.round(average * tracks) : null;
        const comments = finite(session?.comment_count);

        writeCell(cells[indexes.get('平均同接')], average);
        writeCell(cells[indexes.get('最小同接')], minimum);
        writeCell(cells[indexes.get('最大同接')], maximum);
        writeCell(cells[indexes.get('曲数')], tracks);
        writeCell(cells[indexes.get('推定再生数')], estimated, integer);
        writeCell(cells[indexes.get('コメント数')], comments, integer);
      }
    } finally {
      tableEnhancing = false;
    }
  }

  function scheduleTableEnhance(delay = 0) {
    clearTimeout(tableTimer);
    tableTimer = setTimeout(() => {
      tableTimer = null;
      enhanceBroadcastTable();
    }, delay);
  }

  async function loadHostSessions(force = false) {
    if (hostSessionsPromise && !force) return hostSessionsPromise;
    const request = fetch('/api/host-history?mode=sessions&limit=500', {
      cache: force ? 'no-store' : 'default',
      headers: { accept: 'application/json' },
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error || `API ${response.status}`);
      hostSessions = Array.isArray(data.rows) ? data.rows : [];
      return hostSessions;
    }).catch(() => hostSessions);
    hostSessionsPromise = request;
    try {
      return await request;
    } finally {
      if (hostSessionsPromise === request) hostSessionsPromise = null;
    }
  }

  async function loadSeries() {
    if (!active()) return;
    const key = cacheKey();
    if (loadingKey === key) return;
    if (loadedKey === key) {
      draw();
      updateNotice(loadedMeta);
      void loadHostSessions().then(() => scheduleTableEnhance());
      return;
    }
    loadingKey = key;
    selectedMinute = null;
    try {
      let data = readCache();
      if (!data) {
        controller?.abort();
        controller = new AbortController();
        const params = new URLSearchParams({
          from: fromInput.value,
          to: toInput.value,
          v: CACHE_REVISION,
          revision: API_REVISION,
        });
        const response = await fetch(`/api/sakurazaka46jp?${params}`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        data = await response.json();
        if (!response.ok || !data?.ok) throw new Error(data?.error || `API ${response.status}`);
        writeCache(data);
      }
      if (!active()) return;
      series = prepareSeries(data.series);
      loadedKey = key;
      loadedMeta = data;
      draw();
      updateNotice(data);
      void loadHostSessions().then(() => scheduleTableEnhance());
    } catch (error) {
      if (error?.name !== 'AbortError' && active()) {
        series = [];
        loadedKey = '';
        loadedMeta = null;
        draw();
        notice.hidden = false;
        const base = notice.textContent
          .replace(/・比較グラフ取得失敗:.*$/, '')
          .trim();
        notice.textContent = `${base}・比較グラフ取得失敗: ${error.message}`;
      }
    } finally {
      if (loadingKey === key) loadingKey = '';
    }
  }

  function scheduleLoad(delay = 80) {
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
      loadTimer = null;
      if (active()) loadSeries();
    }, delay);
  }

  function handlePointer(event) {
    if (!active() || !series.length) return;
    event.stopImmediatePropagation();
    const rect = canvas.getBoundingClientRect();
    const clientX = event.touches?.[0]?.clientX ?? event.clientX;
    const left = Number(canvas.dataset.sakurazakaLeft) || 58;
    const chartWidth = Number(canvas.dataset.sakurazakaWidth) || Math.max(1, rect.width - 76);
    const maxMinute = Number(canvas.dataset.sakurazakaMaxMinute) || 1;
    selectedMinute = Math.max(0, Math.min(maxMinute, (clientX - rect.left - left) / chartWidth * maxMinute));
    draw();
  }

  const tableObserver = new MutationObserver(() => scheduleTableEnhance());
  const tableHead = document.getElementById('thead');
  const tableBody = document.getElementById('tbody');
  if (tableHead) tableObserver.observe(tableHead, { childList: true, subtree: true });
  if (tableBody) tableObserver.observe(tableBody, { childList: true, subtree: true });

  canvas.addEventListener('click', handlePointer, true);
  canvas.addEventListener('touchstart', handlePointer, { capture: true, passive: true });
  document.querySelectorAll('#modeTabs button').forEach((modeButton) =>
    modeButton.addEventListener('click', () => {
      notice.hidden = active();
      if (active()) {
        notice.textContent = '';
        scheduleTableEnhance();
      }
    }));
  button.addEventListener('click', () => scheduleLoad(120));
  document.getElementById('load')?.addEventListener('click', () => {
    loadedKey = '';
    void loadHostSessions(true).then(() => scheduleTableEnhance());
    scheduleLoad(160);
  });
  document.querySelectorAll('.range-presets button').forEach((preset) =>
    preset.addEventListener('click', () => {
      loadedKey = '';
      scheduleLoad(160);
    }));
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (active() && series.length) draw(); }, 260);
  }, { passive: true });
  if (active()) {
    notice.textContent = '';
    notice.hidden = true;
    scheduleTableEnhance();
    scheduleLoad(0);
  }
})();