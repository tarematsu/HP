const ASSET_VERSION = '20261004.1';
let stationheadStylesPromise = null;

export function ensureStationheadChannelStyles() {
  const existing = document.querySelector('link[data-dashboard-section-style="stationhead"]');
  if (existing) return Promise.resolve();
  if (stationheadStylesPromise) return stationheadStylesPromise;

  stationheadStylesPromise = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `/assets/stationhead.min.css?v=${ASSET_VERSION}`;
    link.dataset.dashboardSectionStyle = 'stationhead';
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', () => reject(new Error('stylesheet failed: stationhead')), { once: true });
    document.head.append(link);
  }).catch((error) => {
    stationheadStylesPromise = null;
    throw error;
  });
  return stationheadStylesPromise;
}

document.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-stationhead-section]');
  if (!button || button.disabled || button.dataset.stationheadSection === 'current') return;
  void ensureStationheadChannelStyles();
}, { capture: true });
