function joinClasses(...values) {
  return values.flat().filter(Boolean).join(' ');
}

export function musicServiceViewClassName(...classes) {
  return joinClasses('regional-music-view', 'is-chart-compact', 'music-service-view', classes);
}

export function musicServiceMeta({
  label = '更新日時',
  valueId = '',
  cadence = '-',
  cadenceId = '',
  id = '',
  className = '',
} = {}) {
  return `<div${id ? ` id="${id}"` : ''} class="${joinClasses('regional-chart-meta', 'music-service-meta', className)}">
    <span>${label} <strong${valueId ? ` id="${valueId}"` : ''}>-</strong></span>
    <span>更新周期 <strong${cadenceId ? ` id="${cadenceId}"` : ''}>${cadence || '-'}</strong></span>
  </div>`;
}

export function musicServiceSection({
  id = '',
  title = '',
  titleId = '',
  kicker = '',
  trailingHtml = '',
  bodyHtml = '',
  className = '',
  hidden = false,
} = {}) {
  const heading = title || kicker || trailingHtml
    ? `<div class="regional-chart-section-head"><div>${kicker ? `<p class="kicker">${kicker}</p>` : ''}${title ? `<h2${titleId ? ` id="${titleId}"` : ''}>${title}</h2>` : ''}</div>${trailingHtml}</div>`
    : '';
  return `<section${id ? ` id="${id}"` : ''} class="${joinClasses('music-service-section', 'regional-chart-section', className)}"${hidden ? ' hidden' : ''}>
    ${heading}
    ${bodyHtml}
  </section>`;
}

const REGIONAL_SPECIAL_SERVICES = new Set(['melon', 'qq_music', 'kugou_music', 'netease_cloud_music']);
const REGIONAL_CADENCE = Object.freeze({
  qq_music: '毎週木曜日18:00',
  kugou_music: '平日11:30 / ACG新歌榜: 水曜11:40',
  netease_cloud_music: '毎週火曜日 16:00',
});

function regionalCadence(service) {
  if (REGIONAL_CADENCE[service]) return REGIONAL_CADENCE[service];
  return service ? '毎週月曜日0:00' : '-';
}

function currentRegionalService() {
  return String(globalThis.location?.hash || '').slice(1);
}

function ensureRegionalNotice(meta) {
  let notice = document.getElementById('regionalMusicNotice');
  if (notice || !meta) return notice;
  notice = document.createElement('p');
  notice.id = 'regionalMusicNotice';
  notice.className = 'notice';
  notice.role = 'status';
  notice.hidden = true;
  const compactNotice = document.getElementById('regionalMusicCompactNotice');
  (compactNotice || meta).insertAdjacentElement('afterend', notice);
  return notice;
}

function enforceRegionalQqLayout() {
  const view = document.getElementById('regionalMusicView');
  const meta = document.getElementById('regionalMusicCompactMeta');
  if (!view || !meta) return false;
  if (!view.classList.contains('regional-music-view')) view.classList.add('regional-music-view');
  if (!view.classList.contains('is-chart-compact')) view.classList.add('is-chart-compact');
  if (!view.classList.contains('music-service-view')) view.classList.add('music-service-view');
  if (meta.hidden) meta.hidden = false;

  const service = currentRegionalService();
  const cadence = document.getElementById('regionalMusicChartCadence');
  const cadenceText = regionalCadence(service);
  if (cadence && cadence.textContent !== cadenceText) cadence.textContent = cadenceText;

  const notice = ensureRegionalNotice(meta);
  if (notice && REGIONAL_SPECIAL_SERVICES.has(service) && !notice.hidden) notice.hidden = true;
  return true;
}

function installRegionalQqLayout() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  let viewObserver = null;
  const attach = () => {
    if (!enforceRegionalQqLayout()) return false;
    if (!viewObserver) {
      const view = document.getElementById('regionalMusicView');
      viewObserver = new MutationObserver(() => enforceRegionalQqLayout());
      viewObserver.observe(view, {
        subtree: true,
        attributes: true,
        attributeFilter: ['hidden', 'class'],
        childList: true,
        characterData: true,
      });
    }
    return true;
  };
  if (!attach()) {
    const mountObserver = new MutationObserver(() => {
      if (attach()) mountObserver.disconnect();
    });
    mountObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  globalThis.addEventListener?.('hashchange', () => queueMicrotask(enforceRegionalQqLayout));
  globalThis.addEventListener?.('popstate', () => queueMicrotask(enforceRegionalQqLayout));
  globalThis.addEventListener?.('dashboard:route-ready', () => queueMicrotask(enforceRegionalQqLayout));
}

installRegionalQqLayout();
